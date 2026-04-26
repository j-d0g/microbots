"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutGrid,
  Mic,
  Trash2,
} from "lucide-react";
import {
  AgentFallback,
  applyAgentEvent,
  sendQuery,
} from "@/lib/agent-client";
import { routeIntent } from "@/lib/agent-router";
import {
  useAgentStore,
  type ChatMessage,
  type RoomKind,
} from "@/lib/store";
import { useWebSpeech } from "@/lib/voice";
import { cn } from "@/lib/cn";

const SUGGESTIONS = [
  "morning brief",
  "show me the graph",
  "open the bug triage workflow",
  "anything wrong with my stack?",
  "draft the friday update",
  "members",
];

const ROOMS: Array<{ kind: RoomKind; label: string }> = [
  { kind: "run_code", label: "run code" },
  { kind: "graph", label: "graph" },
  { kind: "list_workflows", label: "workflows" },
  { kind: "search_memory", label: "memory" },
  { kind: "find_examples", label: "examples" },
  { kind: "settings", label: "settings" },
];

export function ChatPanel() {
  const messages = useAgentStore((s) => s.chatMessages);
  const appendChatMessage = useAgentStore((s) => s.appendChatMessage);
  const clearChatHistory = useAgentStore((s) => s.clearChatHistory);
  const chatRoom = useAgentStore((s) => s.chatRoom);
  const setChatRoom = useAgentStore((s) => s.setChatRoom);
  const dock = useAgentStore((s) => s.dock);
  const agentStatus = useAgentStore((s) => s.agentStatus);
  const toggleUiMode = useAgentStore((s) => s.toggleUiMode);
  const reply = useAgentStore((s) => s.agentReply);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { supported: voiceSupported, listening, start, stop } = useWebSpeech();

  /* keep messages pinned to bottom on update */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, reply]);

  /* autosize textarea */
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, 160);
    ta.style.height = `${next}px`;
  }, [input]);

  const submit = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || busy) return;
      const room = useAgentStore.getState().chatRoom;
      appendChatMessage({
        id: `user-${Date.now()}`,
        role: "user",
        text: trimmed,
        ts: Date.now(),
        room,
        status: "done",
      });
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await sendQuery(trimmed, ctrl.signal);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof AgentFallback) {
          for await (const evt of routeIntent(trimmed)) {
            if (ctrl.signal.aborted) break;
            applyAgentEvent(evt);
          }
        } else {
          // eslint-disable-next-line no-console
          console.error("[chat-panel] sendQuery failed:", err);
        }
      } finally {
        setBusy(false);
        setInput("");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [appendChatMessage, busy],
  );

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      submit(input);
    },
    [input, submit],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <aside
      data-testid="chat-panel"
      className="flex h-full w-full flex-col border-r border-rule bg-paper-0"
    >
      <ChatHeader
        chatRoom={chatRoom}
        setChatRoom={setChatRoom}
        onToggleMode={toggleUiMode}
        onClear={clearChatHistory}
        canClear={messages.length > 0}
      />

      <div
        ref={scrollRef}
        data-testid="chat-message-list"
        className="muji-scroll flex-1 overflow-y-auto px-5 pt-4 pb-2"
      >
        {messages.length === 0 ? (
          <EmptyState onPick={(q) => submit(q)} />
        ) : (
          <ul className="flex flex-col gap-5">
            {messages.map((m) => (
              <li key={m.id}>
                <Message message={m} busy={busy && m.status === "streaming"} />
              </li>
            ))}
            {busy && messages[messages.length - 1]?.role !== "agent" && (
              <li>
                <Pending status={agentStatus || dockLabel(dock)} />
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

/* ---------- header ---------- */

function ChatHeader({
  chatRoom,
  setChatRoom,
  onToggleMode,
  onClear,
  canClear,
}: {
  chatRoom: RoomKind;
  setChatRoom: (r: RoomKind) => void;
  onToggleMode: () => void;
  onClear: () => void;
  canClear: boolean;
}) {
  return (
    <header className="flex shrink-0 flex-col gap-3 border-b border-rule px-5 pt-5 pb-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-35">
          chat
        </span>
        <span className="text-[12px] text-ink-35">·</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-60">
          showing {chatRoom}
        </span>
        <button
          type="button"
          onClick={onToggleMode}
          aria-label="switch to windowed mode"
          title="switch to windowed mode"
          data-testid="chat-toggle-mode"
          className={cn(
            "ml-auto inline-flex h-7 items-center gap-1.5 rounded-sm border border-rule px-2",
            "font-mono text-[10px] uppercase tracking-wider text-ink-60",
            "transition-colors hover:bg-paper-1 hover:text-ink-90",
          )}
        >
          <LayoutGrid size={12} strokeWidth={1.6} />
          windowed
        </button>
      </div>

      <RoomTabs current={chatRoom} onPick={setChatRoom} />

      {canClear && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 self-start font-mono text-[10px] uppercase tracking-wider text-ink-35 hover:text-ink-90 transition-colors"
        >
          <Trash2 size={11} strokeWidth={1.6} />
          clear chat
        </button>
      )}
    </header>
  );
}

function RoomTabs({
  current,
  onPick,
}: {
  current: RoomKind;
  onPick: (r: RoomKind) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-1"
      data-testid="chat-room-tabs"
    >
      {ROOMS.map(({ kind, label }) => {
        const active = kind === current;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            data-active={active}
            data-testid={`chat-tab-${kind}`}
            className={cn(
              "rounded-sm border px-2 py-0.5",
              "font-mono text-[11px] uppercase tracking-wider",
              "transition-colors duration-150",
              active
                ? "border-ink-90 bg-ink-90 text-paper-0"
                : "border-rule text-ink-60 hover:bg-paper-1",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- messages ---------- */

function Message({
  message,
  busy,
}: {
  message: ChatMessage;
  busy: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <article
      data-testid={`chat-msg-${message.role}`}
      data-status={message.status ?? "done"}
      className="flex flex-col gap-1.5"
    >
      <header className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.08em]",
            isUser ? "text-ink-35" : "text-accent-indigo/80",
          )}
        >
          {isUser ? "you" : "agent"}
        </span>
        {message.room && (
          <span className="font-mono text-[10px] tracking-wider text-ink-35">
            · {message.room}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-ink-35">
          {formatTs(message.ts)}
        </span>
      </header>
      <p
        className={cn(
          "whitespace-pre-wrap text-[14px] leading-relaxed text-ink-90",
          isUser && "text-ink-90",
          !isUser && "text-ink-90",
        )}
      >
        {message.text}
        {busy && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-[12px] w-[6px] translate-y-[1px] bg-accent-indigo breathing"
          />
        )}
      </p>
    </article>
  );
}

function Pending({ status }: { status: string }) {
  return (
    <article className="flex flex-col gap-1.5" data-testid="chat-pending">
      <header className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent-indigo/80">
          agent
        </span>
      </header>
      <p className="font-mono text-[12px] text-ink-35">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-indigo align-middle breathing" />
        {status}
      </p>
    </article>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-10 text-center">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-35">
          chat
        </p>
        <h2 className="mt-2 text-[22px] font-medium leading-snug tracking-tight text-ink-90">
          what shall we look at?
        </h2>
        <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-ink-60">
          type or speak. the agent picks the right window and walks you through it.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="font-mono text-[12px] text-ink-60 underline-offset-4 hover:text-ink-90 hover:underline"
            >
              / {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- input ---------- */

interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  busy: boolean;
  listening: boolean;
  voiceSupported: boolean;
  startVoice: () => void;
  stopVoice: () => void;
  onSubmit: (e?: FormEvent) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  dock: ReturnType<typeof useAgentStore.getState>["dock"];
  agentStatus: string;
}

const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    {
      input,
      setInput,
      busy,
      listening,
      voiceSupported,
      startVoice,
      stopVoice,
      onSubmit,
      onKeyDown,
      dock,
      agentStatus,
    },
    ref,
  ) {
    return (
      <form
        onSubmit={onSubmit}
        className="shrink-0 border-t border-rule bg-paper-0 px-5 pt-3 pb-4"
      >
        <div
          className={cn(
            "flex items-end gap-2 rounded-md border bg-paper-1 px-3 py-2",
            "transition-colors duration-150",
            listening
              ? "border-accent-indigo/60"
              : "border-rule focus-within:border-ink-90",
          )}
        >
          {voiceSupported && (
            <button
              type="button"
              onMouseDown={startVoice}
              onMouseUp={stopVoice}
              onMouseLeave={stopVoice}
              onTouchStart={startVoice}
              onTouchEnd={stopVoice}
              data-testid="chat-voice-dot"
              aria-label="hold to talk"
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-sm",
                "transition-colors duration-150",
                listening
                  ? "bg-accent-indigo/15 text-accent-indigo"
                  : "text-ink-35 hover:bg-paper-2 hover:text-ink-90",
              )}
            >
              <Mic size={14} strokeWidth={1.6} />
            </button>
          )}
          <textarea
            ref={ref}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              listening
                ? "listening…"
                : busy
                  ? "thinking…"
                  : "ask the agent. enter to send."
            }
            rows={1}
            disabled={busy}
            data-testid="chat-input"
            className={cn(
              "max-h-[160px] flex-1 resize-none bg-transparent",
              "py-1.5 text-[14px] leading-relaxed tracking-tight text-ink-90",
              "outline-none placeholder:text-ink-35",
              "disabled:opacity-60",
            )}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            data-testid="chat-send"
            className={cn(
              "shrink-0 rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider",
              "transition-all duration-150",
              "disabled:opacity-30 disabled:pointer-events-none",
              busy
                ? "border-ink-90 bg-ink-90 text-paper-0"
                : "border-ink-90 bg-ink-90 text-paper-0 hover:bg-accent-indigo",
            )}
          >
            {busy ? "…" : "send"}
          </button>
        </div>
        <StatusLine busy={busy} dock={dock} agentStatus={agentStatus} listening={listening} />
      </form>
    );
  },
);

function StatusLine({
  busy,
  dock,
  agentStatus,
  listening,
}: {
  busy: boolean;
  dock: ReturnType<typeof useAgentStore.getState>["dock"];
  agentStatus: string;
  listening: boolean;
}) {
  const text = listening
    ? "listening…"
    : busy
      ? agentStatus || dockLabel(dock)
      : "enter to send · shift+enter for newline · hold mic to talk";
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.p
        key={text}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={{ duration: 0.18 }}
        className="mt-2 truncate font-mono text-[10px] tracking-wider text-ink-35"
        data-testid="chat-status"
      >
        {text}
      </motion.p>
    </AnimatePresence>
  );
}

/* ---------- helpers ---------- */

function formatTs(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
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
