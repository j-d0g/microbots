import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { Hairline } from "@/components/primitives/Hairline";

export default function GraphPage() {
  return (
    <section>
      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          memory · live ontology
        </p>
        <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
          What I remember about your work.
        </h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-60">
          Every integration, entity, memory, skill, and workflow — from newest
          to oldest. Nodes settle in as I learn.
        </p>
      </header>
      <Hairline className="mb-6" />
      <div className="h-[640px] w-full border border-rule bg-paper-1">
        <GraphCanvas />
      </div>
    </section>
  );
}
