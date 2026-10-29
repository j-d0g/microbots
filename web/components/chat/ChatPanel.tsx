"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AgentFallback, applyAgentEvent, sendQuery } from "@/lib/agent-client";
import { routeIntent } from "@/lib/agent-router";
import { useAgentStore } from "@/lib/store";
import { useWebSpeech } from "@/lib/voice";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { ChatMessage, PendingMessage } from "./ChatMessage";
import { EmptyState } from "./EmptyState";

export function ChatPanel() {
  const messages = useAgentStore((state) => state.chatMessages);
  const appendChatMessage = useAgentStore((state) => state.appendChatMessage);
  const clearChatHistory = useAgentStore((state) => state.clearChatHistory);
  const dock = useAgentStore((state) => state.dock);
  const agentStatus = useAgentStore((state) => state.agentStatus);
  const toggleUiMode = useAgentStore((state) => state.toggleUiMode);
  const reply = useAgentStore((state) => state.agentReply);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingAnswerRef = useRef<string | null>(null);
  const { supported: voiceSupported, listening, start, stop } = useWebSpeech();

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
  }, [messages, reply]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [input]);

  const submit = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed || busy) return;
      appendChatMessage({
        id: `user-${Date.now()}`,
        role: "user",
        text: trimmed,
        ts: Date.now(),
        room: useAgentStore.getState().chatRoom,
        status: "done",
      });
      setBusy(true);
      const controller = new AbortController();
      try {
        await sendQuery(trimmed, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof AgentFallback) {
          for await (const event of routeIntent(trimmed)) {
            if (controller.signal.aborted) break;
            applyAgentEvent(event);
          }
        } else {
          // eslint-disable-next-line no-console
          console.error("[chat-panel] sendQuery failed:", error);
        }
      } finally {
        setBusy(false);
        setInput("");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [appendChatMessage, busy],
  );

  const submitAnswer = useCallback(
    (answer: string) => {
      if (busy) {
        pendingAnswerRef.current = answer;
        return;
      }
      void submit(answer);
    },
    [busy, submit],
  );

  useEffect(() => {
    if (busy || pendingAnswerRef.current === null) return;
    const answer = pendingAnswerRef.current;
    pendingAnswerRef.current = null;
    void submit(answer);
  }, [busy, submit]);

  const handleSubmit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      void submit(input);
    },
    [input, submit],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <aside
      data-testid="chat-panel"
      className="flex h-full w-full flex-col bg-paper-0"
    >
      <ChatHeader
        onToggleMode={toggleUiMode}
        onClear={clearChatHistory}
        canClear={messages.length > 0}
      />
      <div
        ref={scrollRef}
        data-testid="chat-message-list"
        className="muji-scroll flex-1 overflow-y-auto px-5 pt-6 pb-4"
      >
        {messages.length === 0 ? (
          <EmptyState onPick={(query) => void submit(query)} />
        ) : (
          <ul className="flex flex-col gap-6">
            {messages.map((message) => (
              <li key={message.id}>
                <ChatMessage
                  message={message}
                  busy={busy && message.status === "streaming"}
                  onSubmitAnswer={submitAnswer}
                />
              </li>
            ))}
            {busy && messages[messages.length - 1]?.role !== "agent" && (
              <li>
                <PendingMessage status={agentStatus || dockLabel(dock)} />
              </li>
            )}
          </ul>
        )}
      </div>
      <ChatInput
        ref={inputRef}
        input={input}
        setInput={setInput}
        busy={busy}
        listening={listening}
        voiceSupported={voiceSupported}
        startVoice={start}
        stopVoice={stop}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        dock={dock}
        agentStatus={agentStatus}
      />
    </aside>
  );
}

function dockLabel(state: ReturnType<typeof useAgentStore.getState>["dock"]) {
  switch (state) {
    case "thinking":
      return "thinking…";
    case "speaking":
      return "speaking…";
    case "listening":
      return "listening…";
    default:
      return "ready.";
  }
}
