import React, { useState, useRef, useLayoutEffect, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import ChatInputWidget from "../ChatInputWidget";
import "../../styles/Quizzes/Chatbot.css";

const ChatBot = ({ open: forceOpen = false, initialMessage = "", predefinedQuestions = [] }) => {
  const [open, setOpen] = useState(forceOpen);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [queuedQuestions, setQueuedQuestions] = useState(predefinedQuestions || []);
  const [fadingQuestion, setFadingQuestion] = useState(null);
  const chatBodyRef = useRef(null);
  const [sessionId] = useState(() => {
    const id = localStorage.getItem("chatbot-session") || crypto.randomUUID();
    localStorage.setItem("chatbot-session", id);
    return id;
  });

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  useEffect(() => {
    if (!initialMessage || !sessionId) return;

    const fetchFeedback = async () => {
      try {
        setLoading(true);
        const response = await fetch("https://ivf-backend-server.onrender.com/quiz-feedback-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: initialMessage,
            session_id: sessionId
          })
        });

        if (!response.ok || !response.body) throw new Error("Stream error");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let full = "";
        setMessages([{ type: "bot", text: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          // eslint-disable-next-line no-loop-func
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { type: "bot", text: full };
            return updated;
          });
        }
      } catch (err) {
        setMessages([{ type: "bot", text: "⚠️ Failed to load feedback from AI." }]);
      } finally {
        setLoading(false);
      }
    };

    fetchFeedback();
  }, [initialMessage, sessionId]);

  const handleSendMessage = async ({ text }) => {
    if (!text?.trim() || !sessionId) return;

    const userMsg = { type: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const response = await fetch("https://ivf-backend-server.onrender.com/quiz-feedback-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId })
      });

      if (!response.ok || !response.body) throw new Error("Streaming failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let botText = "";
      setMessages((prev) => [...prev, { type: "bot", text: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        botText += decoder.decode(value, { stream: true });

        // eslint-disable-next-line no-loop-func
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { type: "bot", text: botText };
          return updated;
        });
      }
    } catch (err) {
      console.error("Streaming failed:", err);
      setMessages((prev) => [...prev, { type: "bot", text: "⚠️ Error: AI Assistant is temporarily unavailable." }]);
    } finally {
      setLoading(false);
    }
  };

  const handlePredefinedClick = (question) => {
    setFadingQuestion(question);
    setTimeout(() => {
      setQueuedQuestions(prev => prev.filter(q => q !== question));
      setFadingQuestion(null);
      handleSendMessage({ text: question });
    }, 300); // Match with CSS animation duration
  };

  useLayoutEffect(() => {
    if (chatBodyRef.current) {
      requestAnimationFrame(() => {
        chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      });
    }
  }, [messages, loading]);

  return (
    <>
      {!forceOpen && (
        <button className="chat-toggle" onClick={() => setOpen(!open)}>
          <img src="/icons/chat.svg" alt="Chat" className="chat-icon" />
        </button>
      )}

      {open && window.innerWidth <= 768 && !forceOpen && (
        <button className="chat-close-mobile" onClick={() => setOpen(false)}>
          ✖
        </button>
      )}

      {open && (
        <div className="chat-box">
          <div className="chat-header" style={{ background: "#2563eb", color: "#fff", fontWeight: 600 }}>
            AI-Powered Quiz Feedback & Review ✨
          </div>
          <div className="chat-body" ref={chatBodyRef}>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`chat-msg ${msg.type}`}
                style={{
                  maxWidth: "70%",
                  alignSelf: msg.type === "user" ? "flex-end" : "flex-start",
                  background: msg.type === "user" ? "#2563eb" : "#f1f6fd",
                  color: msg.type === "user" ? "#fff" : "#222",
                  padding: "8px 12px",
                  margin: msg.type === "user" ? "6px" : "0px 15px",
                  borderRadius: "14px",
                  fontSize: "14px",
                  lineHeight: 1.6,
                  textAlign: "justify",
                  whiteSpace: "pre-wrap"
                }}
              >
                {msg.type === "bot" ? (
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                ) : (
                  msg.text
                )}
              </div>
            ))}

            {loading && (
              <div className="chat-msg bot loader" style={{ alignSelf: "flex-start" }}>
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            )}

            {queuedQuestions.length > 0 && (
              <div className="predefined-questions">
                <p style={{ marginTop: "10px", fontWeight: 600 }}>Suggested Questions:</p>
                {queuedQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handlePredefinedClick(q)}
                    className={`predefined-question-btn ${fadingQuestion === q ? "fading" : ""}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ChatInputWidget onSendMessage={handleSendMessage} />
        </div>
      )}
    </>
  );
};

export default ChatBot;




