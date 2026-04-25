import Link from "next/link";
import { Chip } from "@/components/primitives/Chip";
import { Hairline } from "@/components/primitives/Hairline";
import { Recipe } from "@/components/recipe/Recipe";

const DETAIL = {
  "bug-triage-pipeline": {
    title: "Bug triage pipeline",
    trigger: "New message in Slack #product-bugs that looks like a bug report",
    outcome: "Linear issue filed, labelled, assigned; Slack thread back-link posted",
    integrations: ["slack", "linear"],
    confidence: 0.94,
    steps: [
      "Watch #product-bugs for new bug-shaped messages.",
      "Classify severity (high / med / low) from text + the last 90 days of similar reports.",
      "Create a Linear issue in the Bugs project with that severity label.",
      "Assign the issue to whoever fielded the closest area most often in the last 21 days.",
      "Post the Linear link back as a thread reply in Slack.",
    ],
    services: ["triage-classifier", "linear-writer", "slack-threader"],
  },
} as const;

type Slug = keyof typeof DETAIL;

export default async function WorkflowDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const w = DETAIL[id as Slug];
  if (!w) {
    return (
      <section>
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          workflow · not found
        </p>
        <h1 className="mt-2 text-[32px] font-medium tracking-tight">
          I don&apos;t have a workflow by that slug yet.
        </h1>
        <Link
          href="/workflow"
          className="mt-6 inline-block font-mono text-[12px] text-ink-60 underline-offset-4 hover:underline"
        >
          ← back to all workflows
        </Link>
      </section>
    );
  }

  return (
    <section>
      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          workflow · {id}
        </p>
        <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
          {w.title}
        </h1>
        <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-ink-60">
          <span className="text-ink-35">when</span> {w.trigger}{" "}
          <span className="text-ink-35">→</span> {w.outcome}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Chip tone="high">confidence · {w.confidence.toFixed(2)}</Chip>
          {w.integrations.map((i) => (
            <Chip key={i} tone="neutral">
              {i}
            </Chip>
          ))}
        </div>
      </header>

      <Hairline className="mb-6" />
      <Recipe steps={w.steps.slice()} />
      <Hairline className="my-10" />

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-35">
          python microservices backing this
        </h2>
        <ul className="grid grid-cols-3 gap-3">
          {w.services.map((s) => (
            <li
              key={s}
              className="border border-rule bg-paper-1 px-4 py-3 font-mono text-[12px] text-ink-60"
            >
              {s}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
