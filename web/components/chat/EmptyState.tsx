"use client";

const SUGGESTIONS = [
  "morning brief",
  "what's connected to Linear?",
  "show me the Bug Triage workflow",
  "should I automate PR reviews?",
];

export function EmptyState({ onPick }: { onPick: (query: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-5 py-10 text-center">
      <div>
        <h2 className="text-[24px] font-medium leading-snug tracking-tight text-ink-90">
          what would you like to work through?
        </h2>
        <p className="mx-auto mt-2 max-w-[38ch] text-[13px] leading-relaxed text-ink-60">
          Ask in your own words. Notes, workflows, and tools will appear as you need them.
        </p>
      </div>
      <ul className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => onPick(suggestion)}
              className="rounded-full border border-rule bg-paper-0 px-3 py-2 font-mono text-[10px] tracking-wide text-ink-60 transition-colors hover:border-accent-indigo/50 hover:text-ink-90"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
