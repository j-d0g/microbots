import { FloatingDock } from "@/components/dock/FloatingDock";
import { CardStack } from "@/components/cards/CardStack";
import { AgentBridge } from "@/components/agent/AgentBridge";
import { CommandBar } from "@/components/command/CommandBar";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh bg-paper-0 text-ink-90">
      <AgentBridge />
      <main className="relative mx-auto max-w-[1040px] px-12 pb-40 pt-24">
        {children}
      </main>
      <CardStack />
      <FloatingDock />
      <CommandBar />
    </div>
  );
}
