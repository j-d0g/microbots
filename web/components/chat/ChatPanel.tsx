"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { sendQuery } from "@/lib/agent-client";
import { useAgentStore } from "@/lib/store";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { ChatMessage, PendingMessage } from "./ChatMessage";
import { EmptyState } from "./EmptyState";

export function ChatPanel() {
  const messages = useAgentStore((state) => state.chatMessages);
  const appendChatMessage = useAgentStore((state) => state.appendChatMessage);
  const setChatMessageStatus = useAgentStore(
    (state) => state.setChatMessageStatus,
  );
  const finalizeLastAgentMessage = useAgentStore(
    (state) => state.finalizeLastAgentMessage,
  );
  const clearChatHistory = useAgentStore((state) => state.clearChatHistory);
  const dock = useAgentStore((state) => state.dock);
  const agentStatus = useAgentStore((state) => state.agentStatus);
  const reply = useAgentStore((state) => state.agentReply);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingAnswerRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && busy) {
        event.preventDefault();
        abortControllerRef.current?.abort();
        return;
      }
      if (event.key !== "/") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [busy]);

  useEffect(() => {
    if (!busy) requestAnimationFrame(() => inputRef.current?.focus());
  }, [busy]);

  const submit = useCallback(
    async (query: string, existingMessageId?: string) => {
      const trimmed = query.trim();
      if (!trimmed || busy) return;
      const messageId = existingMessageId ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (existingMessageId) {
        setChatMessageStatus(existingMessageId, "done");
      } else {
        appendChatMessage({
          id: messageId,
          role: "user",
          text: trimmed,
          ts: Date.now(),
          room: useAgentStore.getState().chatRoom,
          status: "done",
        });
        setInput("");
      }
      setBusy(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        await sendQuery(trimmed, controller.signal);
        if (controller.signal.aborted) finalizeLastAgentMessage("stopped");
      } catch (error) {
        if (controller.signal.aborted) {
          finalizeLastAgentMessage("stopped");
        } else {
          setChatMessageStatus(messageId, "failed");
          console.warn("[chat-panel] sendQuery failed:", error);
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setBusy(false);
      }
    },
    [
      appendChatMessage,
      busy,
      finalizeLastAgentMessage,
      setChatMessageStatus,
    ],
  );

  const retry = useCallback(
    (id: string) => {
      const message = useAgentStore
        .getState()
        .chatMessages.find((item) => item.id === id && item.role === "user");
      if (message) void submit(message.text, message.id);
    },
    [submit],
  );

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

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
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
      <ChatHeader onClear={clearChatHistory} canClear={messages.length > 0} />
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
                  onRetry={retry}
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
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        onStop={stop}
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
