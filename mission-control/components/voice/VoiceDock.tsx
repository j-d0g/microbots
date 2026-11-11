"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { useMC, useAgentMap, useIsThinking } from "@/lib/client/hooks";
import { useUI } from "@/lib/client/ui-store";
import { actions } from "@/lib/client/actions";
import { hush, startListening, stopListening } from "@/lib/client/voice";
import { Orb } from "./Orb";

const STATE_LABEL = { idle: "Standing by", listening: "Listening", transcribing: "Transcribing", thinking: "Thinking", speaking: "Speaking" };

export function VoiceDock() {
  const messages = useMC((s) => s.snapshot?.messages ?? []);
  const agents = useAgentMap();
  const voiceState = useUI((s) => s.voiceState);
  const interim = useUI((s) => s.interim);
  const speakingId = useUI((s) => s.speakingAgentId);
  const set = useUI((s) => s.set);
  const thinking = useIsThinking("shepherd");
  const [text, setText] = useState("");
  const holding = useRef(false);

  useEffect(() => {
    if (thinking && voiceState === "idle") set({ voiceState: "thinking" });
    if (!thinking && voiceState === "thinking") set({ voiceState: "idle" });
  }, [thinking, voiceState, set]);

  const send = async (t: string) => {
    const v = t.trim();
    if (!v) return;
    setText("");
    hush();
    set({ voiceState: "thinking" });
    try {
      await actions.command(v);
    } finally {
      if (useUI.getState().voiceState === "thinking") set({ voiceState: "idle" });
    }
  };

  const down = async () => {
    if (holding.current) return;
    holding.current = true;
    await startListening();
  };
  const up = async () => {
    if (!holding.current) return;
    holding.current = false;
    const said = await stopListening();
    if (said) void send(said);
  };

  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
    };
    const kd = (e: KeyboardEvent) => {
      if (e.key === "Escape") hush();
      if (e.code === "Space" && !typing(e) && !e.repeat) {
        e.preventDefault();
        void down();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e)) {
        e.preventDefault();
        void up();
      }
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  });

  const recent = messages.slice(-4);
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const speaker = speakingId ? agents[speakingId] : undefined;

  return (
    <div className="panel flex h-[176px] shrink-0 items-center gap-5 px-5">
      <button
        className="relative shrink-0 rounded-full outline-none"
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={() => holding.current && up()}
        title="Hold to talk (or hold Space)"
        aria-label="Hold to talk"
      >
        <Orb size={136} tint={speaker?.color} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className={`label ${voiceState !== "idle" ? "!text-arc-2" : ""}`}>
            {speaker && voiceState === "speaking" ? `${speaker.name} speaking` : STATE_LABEL[voiceState]}
          </span>
          {voiceState === "listening" && <span className="h-1.5 w-1.5 rounded-full bg-lime blink" />}
          <span className="ml-auto font-mono text-[10px] text-ink-3">hold space to talk · esc to hush</span>
        </div>
        <div className="min-h-[52px]">
          <AnimatePresence mode="wait">
            {voiceState === "listening" || voiceState === "transcribing" ? (
              <motion.div key="interim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[17px] leading-snug text-lime/90">
                {interim || "…"}
              </motion.div>
            ) : (
              <motion.div key={lastReply?.id ?? "none"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {lastUser && <div className="mb-1 truncate text-[12px] text-ink-3">You: {lastUser.text}</div>}
                <div className="line-clamp-2 text-[16px] leading-snug text-ink">{lastReply?.text ?? "Hi Jordan. Hold space and tell me what you need."}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Talk to the shepherd… e.g. “research the Pi agent harness” or “what should I do today?”"
            className="min-w-0 flex-1 rounded-lg border border-line-2 bg-void/60 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-arc/60 focus:shadow-[0_0_0_3px_rgba(56,225,255,0.08)]"
          />
          {voiceState === "speaking" ? (
            <button type="button" className="btn !p-2" onClick={hush} aria-label="Hush"><Square size={14} /></button>
          ) : (
            <button type="button" className="btn !p-2" onPointerDown={down} onPointerUp={up} aria-label="Hold to talk"><Mic size={14} /></button>
          )}
          <button type="submit" className="btn btn-arc !p-2" aria-label="Send"><ArrowUp size={14} /></button>
        </form>
        <div className="hidden">{recent.length}</div>
      </div>
    </div>
  );
}
