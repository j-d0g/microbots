"use client";

import { FloatingDock } from "@/components/dock/FloatingDock";
import { CardStack } from "@/components/cards/CardStack";
import { CommandBar } from "@/components/command/CommandBar";
import { Desktop } from "@/components/stage/Desktop";
import { OnboardingRoom } from "@/components/rooms/OnboardingRoom";
import { AgentBridge } from "@/components/agent/AgentBridge";
import { StoreBridge } from "@/components/agent/StoreBridge";
import { SnapshotInspector } from "@/components/agent/SnapshotInspector";
import { useAgentStore } from "@/lib/store";

export default function Home() {
  const onboarded = useAgentStore((s) => s.onboarded);
  const windows = useAgentStore((s) => s.windows);

  if (!onboarded && windows.length === 0) {
    return (
      <>
        <StoreBridge />
        <OnboardingRoom />
      </>
    );
  }

  return (
    <div className="relative min-h-dvh bg-paper-0 text-ink-90">
      <StoreBridge />
      <AgentBridge />
      <Desktop />
      <CardStack />
      <FloatingDock />
      <CommandBar />
      <SnapshotInspector />
    </div>
  );
}
