"use client";

import { FloatingDock } from "@/components/dock/FloatingDock";
import { CardStack } from "@/components/cards/CardStack";
import { CommandBar } from "@/components/command/CommandBar";
import { ModalStack } from "@/components/modal/ModalStack";
import { OnboardingRoom } from "@/components/rooms/OnboardingRoom";
import { AgentBridge } from "@/components/agent/AgentBridge";
import { useAgentStore } from "@/lib/store";

export default function Home() {
  const onboarded = useAgentStore((s) => s.onboarded);
  const modals = useAgentStore((s) => s.modals);

  if (!onboarded && modals.length === 0) {
    return <OnboardingRoom />;
  }

  return (
    <div className="relative min-h-dvh bg-paper-0 text-ink-90">
      <AgentBridge />
      <ModalStack />
      <CardStack />
      <FloatingDock />
      <CommandBar />
    </div>
  );
}
