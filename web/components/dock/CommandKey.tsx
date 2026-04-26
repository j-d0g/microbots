"use client";

import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

/** A `/` key chip in the dock. Click or press `/` anywhere on the page
 *  to open the CommandBar. */
export function CommandKey() {
  const setOpen = useAgentStore((s) => s.setCommandOpen);
  const open = useAgentStore((s) => s.commandOpen);
  return (
    <button
      type="button"
      aria-label="open command bar (press /)"
      onClick={() => setOpen(true)}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-sm border border-rule px-2",
        "font-mono text-[11px] text-ink-60",
        "transition-colors hover:bg-paper-2 hover:text-ink-90",
        open && "bg-paper-2 text-ink-90",
      )}
    >
      <span className="text-[12px]">/</span>
      <span className="whitespace-nowrap">type</span>
    </button>
  );
}
