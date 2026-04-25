import { Chip } from "@/components/primitives/Chip";
import { Hairline } from "@/components/primitives/Hairline";

const YOUR_ORG = [
  { title: "Investor update distiller", one: "pulls Linear + Notion, drafts weekly investor note" },
  { title: "Hiring pipeline nudge", one: "reminds owners of stalled candidates in Ashby" },
];
const NETWORK = [
  { title: "Churn signal sniffer", one: "watches Slack Connect for cooling-off language" },
  { title: "Standup assembler", one: "builds standup from yesterday's PRs + Linear moves" },
  { title: "On-call summariser", one: "turns PagerDuty incidents into a weekly digest" },
];
const SUGGESTED = [
  { title: "Weekly OKR check-in", one: "reads Linear progress, posts to a Notion OKR page" },
  { title: "Inbox zero co-pilot", one: "archives newsletters, summarises threads > 3 days old" },
];

function Column({
  title,
  items,
  tone,
}: {
  title: string;
  items: { title: string; one: string }[];
  tone: "neutral" | "accent";
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          {title}
        </h2>
        <Chip tone={tone}>{items.length}</Chip>
      </div>
      <ul className="space-y-4">
        {items.map((p) => (
          <li
            key={p.title}
            className="border border-rule bg-paper-1 px-4 py-4"
          >
            <h3 className="text-[15px] font-medium text-ink-90">{p.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-60">
              {p.one}
            </p>
            <button
              type="button"
              className="mt-3 font-mono text-[11px] text-ink-60 underline-offset-4 hover:underline"
            >
              try tonight →
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PlaybooksPage() {
  return (
    <section>
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          playbooks · internet of intelligence
        </p>
        <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
          Automations worth borrowing.
        </h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-60">
          From your org, from the curated network, and from what I&apos;ve
          matched to your graph. Trying one queues it for tonight&apos;s
          proposer — nothing deploys without your approval in the morning.
        </p>
      </header>
      <Hairline className="mb-8" />
      <div className="grid grid-cols-3 gap-10">
        <Column title="your org" items={YOUR_ORG} tone="neutral" />
        <Column title="network" items={NETWORK} tone="neutral" />
        <Column title="suggested for you" items={SUGGESTED} tone="accent" />
      </div>
    </section>
  );
}
