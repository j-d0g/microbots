import { Hairline } from "@/components/primitives/Hairline";
import { Chip } from "@/components/primitives/Chip";

const INTEGRATIONS = [
  { slug: "slack", status: "connected" as const },
  { slug: "github", status: "connected" as const },
  { slug: "linear", status: "connected" as const },
  { slug: "gmail", status: "connected" as const },
  { slug: "notion", status: "connected" as const },
  { slug: "perplexity", status: "disconnected" as const },
];

const MEMBERS = [
  { name: "Desmond Zee", email: "desmond@ifactorial.co", role: "owner" as const },
  { name: "Jordan", email: "jordan@ifactorial.co", role: "admin" as const },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-5 font-mono text-[11px] uppercase tracking-wider text-ink-35">
        {title}
      </h2>
      {children}
      <Hairline className="mt-10 mb-10" />
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[720px]">
      <header className="mb-12">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          settings
        </p>
        <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
          Calm defaults.
        </h1>
      </header>

      <Section title="integrations">
        <ul className="divide-y divide-rule border-y border-rule">
          {INTEGRATIONS.map((i) => (
            <li
              key={i.slug}
              className="flex items-center justify-between py-3"
            >
              <span className="font-mono text-[13px] text-ink-90">
                {i.slug}
              </span>
              <Chip
                tone={i.status === "connected" ? "high" : "neutral"}
              >
                {i.status}
              </Chip>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="members & roles">
        <ul className="divide-y divide-rule border-y border-rule">
          {MEMBERS.map((m) => (
            <li
              key={m.email}
              className="flex items-center justify-between py-3"
            >
              <div>
                <p className="text-[14px] text-ink-90">{m.name}</p>
                <p className="font-mono text-[11px] text-ink-35">{m.email}</p>
              </div>
              <Chip tone={m.role === "owner" ? "accent" : "neutral"}>
                {m.role}
              </Chip>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="overnight">
        <p className="text-[14px] text-ink-60">
          The proposer runs at 03:00 local. Anything above the confidence
          threshold below is queued for your morning brief.
        </p>
        <div className="mt-4 flex items-center gap-4">
          <Chip tone="accent">threshold · 0.80</Chip>
          <span className="font-mono text-[11px] text-ink-35">
            (edit via waffle — &quot;raise my threshold to 0.9&quot;)
          </span>
        </div>
      </Section>

      <Section title="voice">
        <p className="text-[14px] text-ink-60">
          Deepgram for listening, Cartesia for speaking. Silence unless I have
          something worth saying.
        </p>
      </Section>

      <Section title="memory">
        <p className="text-[14px] text-ink-60">
          Export, scope-delete, retention. Nothing ambient leaves the device
          until you ask me to write a memory.
        </p>
      </Section>
    </div>
  );
}
