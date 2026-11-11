"use client";
import { useEffect, useState } from "react";
import { BellOff, Focus, RotateCcw, Volume2 } from "lucide-react";
import { useConnected, useMC } from "@/lib/client/hooks";
import { useUI, type Attention } from "@/lib/client/ui-store";
import { actions } from "@/lib/client/actions";
import { briefHeld } from "@/lib/client/voice";

const MODES: { id: Attention; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "normal", label: "Live", icon: <Volume2 size={12} />, hint: "Speak updates as they happen" },
  { id: "focus", label: "Focus", icon: <Focus size={12} />, hint: "Only one-line gists; the rest waits for 'brief me'" },
  { id: "mute", label: "Mute", icon: <BellOff size={12} />, hint: "No audio; everything stays on screen" },
];

export function TopBar() {
  const connected = useConnected();
  const snap = useMC((s) => s.snapshot);
  const attention = useUI((s) => s.attention);
  const held = useUI((s) => s.held);
  const set = useUI((s) => s.set);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 px-5">
      <div className="flex items-center gap-3">
        <div className="relative h-7 w-7">
          <span className="absolute inset-0 rounded-full border border-arc/60" />
          <span className="absolute inset-[5px] rounded-full bg-arc/80 shadow-[0_0_16px_#38e1ff]" />
        </div>
        <div>
          <div className="font-mono text-[13px] font-semibold tracking-[0.28em] text-ink glow-text">MISSION CONTROL</div>
          <div className="font-mono text-[9.5px] tracking-[0.2em] text-ink-3">MICROBOTS · V2</div>
        </div>
      </div>
      <div className="ml-4 flex items-center gap-2 font-mono text-[10.5px] text-ink-3">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-lime shadow-[0_0_8px_#5cf2a5]" : "bg-rose blink"}`} />
        {connected ? "LINK" : "OFFLINE"}
        <span className={`chip ${snap.demo ? "!border-amber/50 !text-amber" : ""}`} title={snap.demo ? "No API key: scripted demo model" : undefined}>
          {snap.demo ? "DEMO MODEL" : snap.model}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {held.length > 0 && (
          <button className="btn btn-arc" onClick={briefHeld}>Brief me ({held.length})</button>
        )}
        <div className="flex rounded-lg border border-line-2 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              title={m.hint}
              onClick={() => set({ attention: m.id })}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] transition ${attention === m.id ? "bg-arc/15 text-arc-2" : "text-ink-3 hover:text-ink-2"}`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
        <button className="btn !p-1.5" title="Reset demo data" onClick={() => confirm("Reset all data to the demo seed?") && actions.reset()}>
          <RotateCcw size={13} />
        </button>
        <div className="w-[74px] text-right font-mono text-[15px] tabular-nums text-ink-2">
          {now ? now.toLocaleTimeString([], { hour12: false }) : ""}
        </div>
      </div>
    </header>
  );
}
