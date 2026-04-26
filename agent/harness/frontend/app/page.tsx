"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error, addToolResult } = useChat({
    api: "/api/chat",
    maxSteps: 8,
  });

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 16px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>microbot harness — v0</h1>
      <p style={{ color: "#666", marginBottom: 20, fontSize: 13 }}>
        Type a coding task. The agent runs Python, saves workflows, finds templates, asks questions.
      </p>

      <div
        style={{
          minHeight: 360,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          padding: 16,
          marginBottom: 12,
          background: "#fafafa",
          overflowY: "auto",
        }}
        data-testid="chat-history"
      >
        {messages.length === 0 ? (
          <div style={{ color: "#aaa", fontSize: 13 }}>No messages yet.</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 14 }} data-role={m.role}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {m.role}
              </div>
              {m.parts?.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <div key={i} style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }} data-testid="message-text">
                      {part.text}
                    </div>
                  );
                }
                if (part.type === "tool-invocation") {
                  const inv = part.toolInvocation;
                  // Client-side ask_user: render an answer prompt when the call lands.
                  if (inv.toolName === "ask_user" && inv.state === "call") {
                    return (
                      <AskUserPrompt
                        key={i}
                        toolCallId={inv.toolCallId}
                        question={(inv.args as { question?: string })?.question ?? ""}
                        options={(inv.args as { options?: string[] })?.options}
                        onAnswer={(answer) => addToolResult({ toolCallId: inv.toolCallId, result: answer })}
                      />
                    );
                  }
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#eef",
                        border: "1px solid #cce",
                        borderRadius: 6,
                        padding: "6px 10px",
                        margin: "6px 0",
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12,
                      }}
                      data-testid="tool-invocation"
                      data-tool-name={inv.toolName}
                      data-tool-state={inv.state}
                    >
                      <div style={{ fontWeight: 600 }}>
                        🔧 {inv.toolName} <span style={{ color: "#888", fontWeight: 400 }}>({inv.state})</span>
                      </div>
                      {"args" in inv && inv.args ? (
                        <details style={{ marginTop: 4 }}>
                          <summary style={{ cursor: "pointer", color: "#666" }}>args</summary>
                          <pre style={{ margin: 0, fontSize: 11 }}>{JSON.stringify(inv.args, null, 2)}</pre>
                        </details>
                      ) : null}
                      {inv.state === "result" && "result" in inv ? (
                        <details style={{ marginTop: 4 }}>
                          <summary style={{ cursor: "pointer", color: "#666" }}>result</summary>
                          <pre style={{ margin: 0, fontSize: 11 }}>{JSON.stringify(inv.result, null, 2)}</pre>
                        </details>
                      ) : null}
                    </div>
                  );
                }
                return null;
              }) ?? <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.content}</div>}
            </div>
          ))
        )}
        {isLoading ? <div style={{ color: "#888", fontSize: 12, marginTop: 8 }}>thinking…</div> : null}
        {error ? (
          <div style={{ color: "#a00", fontSize: 12, marginTop: 8 }} data-testid="chat-error">
            error: {error.message}
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="ask me to compute, fetch, parse…"
          style={{ flex: 1, padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}
          data-testid="chat-input"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: "10px 18px",
            border: "1px solid #333",
            borderRadius: 6,
            background: "#111",
            color: "white",
            cursor: isLoading ? "not-allowed" : "pointer",
            fontSize: 14,
          }}
          data-testid="chat-submit"
        >
          {isLoading ? "…" : "send"}
        </button>
      </form>
    </main>
  );
}

function AskUserPrompt({
  toolCallId,
  question,
  options,
  onAnswer,
}: {
  toolCallId: string;
  question: string;
  options?: string[];
  onAnswer: (answer: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <div
      style={{
        background: "#fef9e7",
        border: "1px solid #f0d870",
        borderRadius: 6,
        padding: "10px 12px",
        margin: "6px 0",
        fontSize: 13,
      }}
      data-testid="ask-user-prompt"
      data-tool-call-id={toolCallId}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>❓ {question}</div>
      {options && options.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onAnswer(opt)}
              data-testid="ask-user-option"
              style={{
                padding: "4px 10px",
                border: "1px solid #c4a020",
                borderRadius: 4,
                background: "white",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onAnswer(text.trim());
          }}
          style={{ display: "flex", gap: 6, marginTop: 4 }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="answer…"
            style={{ flex: 1, padding: "4px 8px", fontSize: 12, border: "1px solid #ddd", borderRadius: 4 }}
            data-testid="ask-user-input"
          />
          <button
            type="submit"
            data-testid="ask-user-submit"
            style={{ padding: "4px 10px", fontSize: 12, border: "1px solid #333", borderRadius: 4, background: "#111", color: "white", cursor: "pointer" }}
          >
            send
          </button>
        </form>
      )}
    </div>
  );
}
