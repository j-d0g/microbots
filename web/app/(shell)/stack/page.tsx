import { Hairline } from "@/components/primitives/Hairline";
import { ServiceBlock } from "@/components/stack-blocks/ServiceBlock";

const SERVICES = [
  {
    slug: "triage-classifier",
    purpose: "classifies Slack bug reports into severity + area",
    runtime: "python 3.11",
    deployed_at: "2 days ago",
    health: "ok" as const,
    column: 0,
  },
  {
    slug: "linear-writer",
    purpose: "creates Linear issues with labels + owner",
    runtime: "python 3.11",
    deployed_at: "2 days ago",
    health: "ok" as const,
    column: 0,
  },
  {
    slug: "slack-threader",
    purpose: "posts thread replies with linked resources",
    runtime: "python 3.11",
    deployed_at: "2 days ago",
    health: "ok" as const,
    column: 0,
  },
  {
    slug: "notion-scribe",
    purpose: "writes updates to Notion docs",
    runtime: "python 3.11",
    deployed_at: "6 days ago",
    health: "ok" as const,
    column: 1,
  },
  {
    slug: "gmail-distiller",
    purpose: "summarises threads for weekly digests",
    runtime: "python 3.11",
    deployed_at: "6 days ago",
    health: "warn" as const,
    column: 1,
  },
];

export default function StackPage() {
  const columns: Record<number, typeof SERVICES> = {};
  for (const s of SERVICES) {
    (columns[s.column] ??= []).push(s);
  }
  return (
    <section>
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          microservices · {SERVICES.length} deployed
        </p>
        <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
          Your stack, block by block.
        </h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-60">
          Each block is a small Python service. Workflows own a column;
          blocks stack.
        </p>
      </header>
      <Hairline className="mb-6" />
      <div className="grid grid-cols-3 gap-6">
        {Object.entries(columns).map(([col, list]) => (
          <div key={col} className="flex flex-col gap-2">
            {list.map((s) => (
              <ServiceBlock key={s.slug} service={s} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
