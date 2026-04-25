import { cn } from "@/lib/cn";

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "high" | "med" | "low" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5",
        "font-mono text-[11px] uppercase tracking-wider",
        tone === "neutral" && "border-rule text-ink-60",
        tone === "high" &&
          "border-confidence-high/40 text-confidence-high",
        tone === "med" &&
          "border-confidence-med/40 text-confidence-med",
        tone === "low" &&
          "border-confidence-low/40 text-confidence-low",
        tone === "accent" &&
          "border-accent-indigo/40 text-accent-indigo",
        className,
      )}
    >
      {children}
    </span>
  );
}
