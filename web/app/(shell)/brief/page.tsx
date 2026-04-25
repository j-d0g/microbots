import { BriefCard, type BriefProposal } from "@/components/cards/BriefCard";
import { Hairline } from "@/components/primitives/Hairline";

const PROPOSALS: BriefProposal[] = [
  {
    id: "p-001",
    title:
      "Auto-triage #product-bugs in Slack into Linear with labels and owner",
    why: "Every weekday you triage 4–7 bug reports from #product-bugs, set a severity label, and assign an owner. The signal for severity is reliable; the owner comes from your last three weeks of assignment patterns.",
    integrations: ["slack", "linear"],
    confidence: 0.94,
    recipe: [
      "When a new message lands in Slack #product-bugs that looks like a bug report…",
      "classify severity (high/med/low) with the last 90 days as context,",
      "create a Linear issue in the Bugs project with that severity label,",
      "assign it to the owner who has fielded the most similar area in the last 21 days,",
      "post a Linear link back as a thread reply in Slack.",
    ],
  },
  {
    id: "p-002",
    title:
      "Draft the weekly founders' update from Notion, Linear, and Gmail at 17:00 Friday",
    why: "You hand-write the founder update every Friday from three sources. A template + a scraper across the three tools would give you a 70% draft you only need to season.",
    integrations: ["notion", "linear", "gmail"],
    confidence: 0.87,
    recipe: [
      "At 17:00 Fridays, pull shipped Linear issues this week,",
      "pull investor emails sent or received this week,",
      "pull Notion edits to the weekly doc,",
      "draft the update into a new Notion page under 'Founders updates' and DM you the link.",
    ],
  },
  {
    id: "p-003",
    title: "Unsubscribe the 8 newsletters you've never opened in 90 days",
    why: "Low-stakes housekeeping. You haven't opened anything from these senders this quarter — I can run the unsubscribe links and archive the trail.",
    integrations: ["gmail"],
    confidence: 0.71,
    recipe: [
      "Collect senders with 0 opens in the last 90 days and ≥6 received,",
      "visit each unsubscribe link,",
      "archive the trail to a 'Unsubscribed' label,",
      "summarise the list back to you in the morning brief.",
    ],
  },
];

export default function BriefPage() {
  return (
    <section>
      <header className="mb-12">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          morning · {new Date().toLocaleDateString(undefined, { weekday: "long" })}
        </p>
        <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
          Three for you.
        </h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-60">
          I read last night. Here's what I'd take off your plate today. Approve
          them and I'll run each in shadow mode first, then promote to live after
          one clean cycle.
        </p>
      </header>

      <div className="space-y-6">
        {PROPOSALS.map((p) => (
          <BriefCard key={p.id} proposal={p} />
        ))}
      </div>

      <Hairline className="my-12" />

      <section>
        <h2 className="mb-4 font-mono text-[11px] uppercase tracking-wider text-ink-35">
          yesterday · 3 ran · 47 memories · 2 new entities
        </h2>
        <ul className="space-y-2 text-[14px] text-ink-60">
          <li className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-confidence-high" />
            <span>standup-summary · 12 triggers · no errors</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-confidence-high" />
            <span>inbox-zero-sweep · 3 triggers · no errors</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-confidence-med" />
            <span>pr-reminder · 8 triggers · 1 skipped (draft PR)</span>
          </li>
        </ul>
      </section>
    </section>
  );
}
