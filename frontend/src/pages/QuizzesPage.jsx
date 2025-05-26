import React, { useState } from "react";
import "../styles/QuizzesPage.css";

const QuizzesPage = () => {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [feedbackShown, setFeedbackShown] = useState({});
  const [score, setScore] = useState(0);
  const [quizStarted, setQuizStarted] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const startQuiz = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("https://ivf-backend-server.onrender.com/start-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "IVF" }),
      });

      if (!res.ok) throw new Error("Server error: " + res.statusText);

      const data = await res.json();
      console.log("✅ Received quiz data:", data);

      if (!data.questions || !Array.isArray(data.questions)) {
        throw new Error("Invalid quiz data format received from server.");
      }

      setQuestions(data.questions);
      setQuizStarted(true);
    } catch (err) {
      console.error("❌ Failed to fetch quiz:", err);
      setError("Failed to load quiz. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = (questionId, selectedOption) => {
    if (feedbackShown[questionId]) return;

    setAnswers((prev) => ({
      ...prev,
      [questionId]: selectedOption,
    }));

    setFeedbackShown((prev) => ({
      ...prev,
      [questionId]: true,
    }));
  };

  const submitQuiz = () => {
    let score = 0;
    questions.forEach((q) => {
      if (answers[q.id] === q.correct) {
        score++;
      }
    });
    setScore(score);
    setShowResult(true);
  };

  const restart = () => {
    setAnswers({});
    setScore(0);
    setQuizStarted(false);
    setShowResult(false);
    setQuestions([]);
    setFeedbackShown({});
    setError("");
  };

  return (
    <div className="quiz-container">
      <h2>IVF Knowledge Quizzes 🧠</h2>

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <div className="loading-box">
          <div className="spinner"></div>
          <p>Generating your quiz… please wait ⏳</p>
        </div>
      ) : !quizStarted ? (
        <button className="start-button" onClick={startQuiz}>
          Start Quiz
        </button>
      ) : showResult ? (
        <div className="result-box">
          <h3>Quiz Completed 🎉</h3>
          <p>
            You scored {score} out of {questions.length}
          </p>
          <button className="restart-button" onClick={restart}>
            Try Again
          </button>
        </div>
      ) : (
        <form
          className="all-questions-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitQuiz();
          }}
        >
          {questions.map((q, index) => {
            const selected = answers[q.id];
            const isCorrect = selected === q.correct;
            const showFeedback = feedbackShown[q.id];

            return (
              <div key={q.id} className="question-block">
                <h4>
                  {index + 1}. {q.text}
                </h4>
                <ul className="options-list">
                  {q.options.map((option, idx) => {
                    let optionClass = "option-label";
                    let feedbackIcon = null;

                    if (showFeedback) {
                      if (option === selected && selected === q.correct) {
                        optionClass += " correct";
                        feedbackIcon = "✅";
                      } else if (option === selected && selected !== q.correct) {
                        optionClass += " incorrect";
                        feedbackIcon = "❌";
                      } else if (option === q.correct) {
                        optionClass += " correct";
                      }
                    }

                    return (
                      <li key={idx}>
                        <label className={optionClass}>
                          <input
                            type="radio"
                            name={`question-${q.id}`}
                            value={option}
                            disabled={showFeedback}
                            checked={selected === option}
                            onChange={() => handleAnswer(q.id, option)}
                          />
                          {option}{" "}
                          {feedbackIcon && <span className="feedback-icon">{feedbackIcon}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {showFeedback && (
                  <div className="feedback-text">
                    {isCorrect
                      ? "Correct ✅"
                      : `Incorrect ❌. Correct answer: ${q.correct}`}
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="submit"
            className="submit-button"
            disabled={Object.keys(answers).length < questions.length}
          >
            Submit Quiz
          </button>
        </form>
      )}
    </div>
  );
};

export default QuizzesPage;





