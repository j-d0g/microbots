import { cn } from "@/lib/cn";

interface Service {
  slug: string;
  purpose: string;
  runtime: string;
  deployed_at: string;
  health: "ok" | "warn" | "down";
}

const HEALTH_TONE: Record<Service["health"], string> = {
  ok: "bg-confidence-high",
  warn: "bg-confidence-med",
  down: "bg-confidence-low",
};

export function ServiceBlock({ service }: { service: Service }) {
  return (
    <article
      className={cn(
        "relative border border-rule bg-paper-1 px-4 py-3",
        "transition-colors hover:bg-paper-2",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-mono text-[13px] text-ink-90">{service.slug}</h3>
        <span
          aria-label={`health ${service.health}`}
          className={cn("mt-1 h-1.5 w-1.5 rounded-full", HEALTH_TONE[service.health])}
        />
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-60">
        {service.purpose}
      </p>
      <p className="mt-3 font-mono text-[10px] text-ink-35">
        {service.runtime} · {service.deployed_at}
      </p>
    </article>
  );
}
