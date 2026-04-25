"use client";

import { useAgentStore } from "@/lib/store";

export default function WafflePage() {
  const transcript = useAgentStore((s) => s.transcript);
  const dock = useAgentStore((s) => s.dock);
  return (
    <section className="flex min-h-[540px] flex-col items-center justify-center text-center">
      <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
        waffle
      </p>
      <h1 className="mt-3 text-[40px] font-medium leading-[1.1] tracking-tight">
        What&apos;s on your mind?
      </h1>
      <p className="mt-3 max-w-[480px] text-[15px] leading-relaxed text-ink-60">
        Press and hold the dot below. Tell me the part of your day you wish
        someone else was doing.
      </p>

      <div className="mt-12 min-h-[120px] max-w-[640px]">
        {transcript ? (
          <p className="ink-in text-[18px] leading-relaxed text-ink-90">
            {transcript}
          </p>
        ) : (
          <p className="font-mono text-[12px] text-ink-35">
            {dock === "listening" ? "listening…" : "silence."}
          </p>
        )}
      </div>
    </section>
  );
}
