import os
import tempfile
from uuid import uuid4
from datetime import datetime
import json
import re
from uuid import uuid4
from dotenv import load_dotenv
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import openai
import qdrant_client

from prompts.prompt import engineeredprompt
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_qdrant import Qdrant
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.chains import create_history_aware_retriever, create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_community.chat_message_histories.in_memory import ChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app, origins=["https://ivfvirtualtrainingassistantdsah.onrender.com"])

# === SESSION STATE ===
chat_sessions = {}
collection_name = os.getenv("QDRANT_COLLECTION_NAME")

# === VECTOR DB ===
def get_vector_store():
    client = qdrant_client.QdrantClient(
        url=os.getenv("QDRANT_HOST"),
        api_key=os.getenv("QDRANT_API_KEY"),
    )
    embeddings = OpenAIEmbeddings()
    return Qdrant(client=client, collection_name=collection_name, embeddings=embeddings)

vector_store = get_vector_store()

# === CONVERSATIONAL RAG SETUP ===
def get_context_retriever_chain():
    retriever = vector_store.as_retriever()
    prompt = ChatPromptTemplate.from_messages([
        MessagesPlaceholder("chat_history"),
        ("user", "{input}"),
        ("user", "Given the above conversation, generate a search query to look up in order to get information relevant to the conversation"),
    ])
    return create_history_aware_retriever(ChatOpenAI(), retriever, prompt)

def get_conversational_rag_chain():
    retriever_chain = get_context_retriever_chain()
    prompt = ChatPromptTemplate.from_messages([
        ("system", engineeredprompt),
        MessagesPlaceholder("chat_history"),
        ("user", "{input}")
    ])
    return create_retrieval_chain(retriever_chain, create_stuff_documents_chain(ChatOpenAI(), prompt))

rag_chain = get_conversational_rag_chain()

# === MEMORY WRAPPER ===
def get_memory(session_id):
    history = ChatMessageHistory()
    if session_id in chat_sessions:
        for msg in chat_sessions[session_id]:
            if msg["role"] == "user":
                history.add_user_message(msg["content"])
            elif msg["role"] == "assistant":
                history.add_ai_message(msg["content"])
    return history

chain_with_memory = RunnableWithMessageHistory(
    rag_chain,
    lambda session_id: get_memory(session_id),
    input_messages_key="input",
    history_messages_key="chat_history",
)

# === /generate endpoint ===
@app.route("/generate", methods=["POST"])
def generate():
    session_id = request.form.get("session_id") or request.args.get("session_id")
    data = {}

    if request.content_type.startswith("multipart/form-data"):
        audio_file = request.files.get("audio")
        if not audio_file:
            return jsonify({"response": "No audio file provided"}), 400
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp:
            audio_path = temp.name
            audio_file.save(audio_path)
        with open(audio_path, "rb") as af:
            transcript = openai.Audio.transcribe("whisper-1", af)["text"]
        os.remove(audio_path)
        data["message"] = transcript
    else:
        data = request.get_json()

    if not data or not data.get("message"):
        return jsonify({"response": "No input provided"}), 400

    session_id = session_id or data.get("session_id") or str(uuid4())
    user_input = data["message"]

    # Invoke the RAG chain
    response = chain_with_memory.invoke(
        {"input": user_input},
        config={"configurable": {"session_id": session_id}},
    )
    answer = response["answer"]

    # Store in session memory
    if session_id not in chat_sessions:
        chat_sessions[session_id] = []
    chat_sessions[session_id].append({"role": "user", "content": user_input})
    chat_sessions[session_id].append({"role": "assistant", "content": answer})

    return jsonify({
        "response": answer,
        "session_id": session_id
    })

# === /stream endpoint ===
@app.route("/stream", methods=["POST"])
def stream():
    data = request.get_json()
    session_id = data.get("session_id", str(uuid4()))
    user_input = data.get("message")

    if not user_input:
        return jsonify({"error": "No input message"}), 400

    def generate():
        answer = ""
        for chunk in chain_with_memory.stream(
            {"input": user_input},
            config={"configurable": {"session_id": session_id}},
        ):
            token = chunk.get("answer", "")
            answer += token
            yield token

        # Append to session memory after complete
        if session_id not in chat_sessions:
            chat_sessions[session_id] = []
        chat_sessions[session_id].append({"role": "user", "content": user_input})
        chat_sessions[session_id].append({"role": "assistant", "content": answer})

    return Response(generate(), content_type="text/plain")

# === /reset endpoint ===
@app.route("/reset", methods=["POST"])
def reset():
    session_id = request.json.get("session_id")
    if session_id in chat_sessions:
        del chat_sessions[session_id]
    return jsonify({"message": "Session reset"}), 200

@app.route("/start-quiz", methods=["POST"])
def start_quiz():
    try:
        session_id = request.json.get("session_id", str(uuid4()))
        topic = request.json.get("topic", "IVF")
        difficulty = request.json.get("difficulty", "mixed")  # ✅ new param

        rag_prompt = (
            f"You are an IVF virtual training assistant. Generate exactly 20 multiple-choice questions on '{topic}'. "
            f"Each question must reflect '{difficulty}' difficulty level. Return them strictly as a JSON array. "
            "Each object must follow this format:\n"
            '{ "id": "q1", "text": "...", "options": ["A", "B", "C", "D"], "correct": "B", "difficulty": "easy" }\n'
            "Respond ONLY with valid JSON — no markdown, commentary, or explanations."
        )

        # 🧠 Ask AI via RAG
        response = chain_with_memory.invoke(
            {"input": rag_prompt},
            config={"configurable": {"session_id": session_id}},
        )
        raw_answer = response["answer"]
        print("✅ AI response received")

        # 🔍 Clean and parse JSON safely
        raw_cleaned = re.sub(r"```json|```", "", raw_answer).strip()
        questions = json.loads(raw_cleaned)

        # ✅ Validate structure
        if not isinstance(questions, list) or not all(
            "text" in q and "options" in q and "correct" in q and "difficulty" in q for q in questions
        ):
            raise ValueError("Parsed questions are not valid or missing difficulty field.")

        print("✅ Parsed question example:", questions[0])

        # 💾 Save history (optional)
        if session_id not in chat_sessions:
            chat_sessions[session_id] = []
        chat_sessions[session_id].append({"role": "user", "content": rag_prompt})
        chat_sessions[session_id].append({"role": "assistant", "content": raw_answer})

        return jsonify({
            "questions": questions,
            "session_id": session_id
        })

    except Exception as e:
        print("❌ Failed to parse quiz questions:", str(e))
        print("🛠 Raw AI output:", raw_answer if 'raw_answer' in locals() else "No output")

        return jsonify({
            "error": "Failed to generate valid quiz from AI response.",
            "details": str(e)
        }), 500
    
@app.route("/quiz-feedback-stream", methods=["POST"])
def quiz_feedback_stream():
    try:
        data = request.get_json()
        session_id = data.get("session_id", str(uuid4()))
        prompt = data.get("prompt") or data.get("message", "").strip()
        context_items = data.get("context", [])  # 💡 Injected Q&A context from frontend

        # Build context string from failed Q&A
        context_string = "\n".join([
            f"Q: {item['text']}\nUser Answer: {item['userAnswer']}\nCorrect Answer: {item['correct']}"
            for item in context_items
        ]) if context_items else ""

        if not prompt:
            return jsonify({"error": "Missing prompt or message"}), 400

        # Final input includes both context and question
        full_prompt = (
            f"You are a helpful IVF tutor. The following questions were answered incorrectly by the trainee:\n\n"
            f"{context_string}\n\nNow answer this question:\n{prompt}"
        )

        def stream_response():
            for chunk in chain_with_memory.stream(
                {"input": full_prompt},
                config={"configurable": {"session_id": session_id}}
            ):
                yield chunk.get("answer", "")

        return Response(stream_response(), content_type="text/plain")

    except Exception as e:
        return jsonify({"error": str(e)}), 500

performance_log = []

@app.route("/submit-quiz", methods=["POST"])
def submit_quiz():
    try:
        data = request.get_json()
        attempt_number = len(performance_log) + 1
        entry = {
            "attempt": attempt_number,
            "score": data.get("score", 0),
            "correct": data.get("correct", 0),
            "duration": data.get("duration_minutes", 0),
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M")
        }
        performance_log.append(entry)
        return jsonify({"status": "success", "attempt": attempt_number}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/quiz-performance", methods=["GET"])
def quiz_performance():
    try:
        attempts = [entry["attempt"] for entry in performance_log]
        scores = [entry["score"] for entry in performance_log]
        correct = [entry["correct"] for entry in performance_log]
        durations = [entry["duration"] for entry in performance_log]
        timestamps = [entry["timestamp"] for entry in performance_log]

        return jsonify({
            "attempt": attempts,
            "score": scores,
            "correct_answers": correct,
            "duration_minutes": durations,
            "timestamp": timestamps
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)


