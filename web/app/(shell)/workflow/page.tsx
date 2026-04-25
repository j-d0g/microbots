import Link from "next/link";
import { Hairline } from "@/components/primitives/Hairline";
import { Chip } from "@/components/primitives/Chip";

const WORKFLOWS = [
  {
    slug: "bug-triage-pipeline",
    title: "Bug triage pipeline",
    trigger: "Slack #product-bugs",
    outcome: "Linear issue with severity + owner",
    runs_last_7d: 34,
    integrations: ["slack", "linear"],
  },
  {
    slug: "weekly-update",
    title: "Weekly founders' update draft",
    trigger: "17:00 Friday",
    outcome: "Notion draft + DM to you",
    runs_last_7d: 1,
    integrations: ["notion", "linear", "gmail"],
  },
  {
    slug: "pr-reminder",
    title: "Stale PR reminder",
    trigger: "PR > 48h without review",
    outcome: "Nudge in Slack thread",
    runs_last_7d: 12,
    integrations: ["github", "slack"],
  },
];

export default function WorkflowIndex() {
  return (
    <section>
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          workflows · {WORKFLOWS.length} live
        </p>
        <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
          Your automations, in plain English.
        </h1>
      </header>

      <ul className="divide-y divide-rule border-y border-rule">
        {WORKFLOWS.map((w) => (
          <li key={w.slug}>
            <Link
              href={`/workflow/${w.slug}` as "/workflow"}
              className="group flex items-start justify-between gap-6 py-5 transition-colors hover:bg-paper-1"
            >
              <div className="flex-1">
                <h2 className="text-[20px] font-medium tracking-tight text-ink-90">
                  {w.title}
                </h2>
                <p className="mt-1 text-[14px] text-ink-60">
                  <span className="text-ink-35">when</span> {w.trigger}{" "}
                  <span className="text-ink-35">→</span> {w.outcome}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Chip tone="neutral">{w.runs_last_7d} / 7d</Chip>
                {w.integrations.map((i) => (
                  <Chip key={i} tone="neutral">
                    {i}
                  </Chip>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Hairline className="mt-8" />
      <p className="mt-4 font-mono text-[11px] text-ink-35">
        say &quot;show me the bug triage one&quot; to open it.
      </p>
    </section>
  );
}
