"use client";

import { FloatingDock } from "@/components/dock/FloatingDock";
import { CardStack } from "@/components/cards/CardStack";
import { CommandBar } from "@/components/command/CommandBar";
import { Desktop } from "@/components/stage/Desktop";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { AgentBridge } from "@/components/agent/AgentBridge";
import { StoreBridge } from "@/components/agent/StoreBridge";
import { SnapshotInspector } from "@/components/agent/SnapshotInspector";
import { VoiceBridge } from "@/components/agent/VoiceBridge";
import { OnboardingOverlay } from "@/components/onboarding/OnboardingOverlay";
import { useAgentStore } from "@/lib/store";

export default function Home() {
  const uiMode = useAgentStore((s) => s.uiMode);

  if (uiMode === "chat") {
    return (
      <div className="relative min-h-dvh bg-paper-0 text-ink-90">
        <StoreBridge />
        <AgentBridge />
        <VoiceBridge />
        <ChatLayout />
        <CardStack />
        <SnapshotInspector />
        <OnboardingOverlay />
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh bg-paper-0 text-ink-90">
      <StoreBridge />
      <AgentBridge />
      <VoiceBridge />
      <Desktop />
      <CardStack />
      <FloatingDock />
      <CommandBar />
      <SnapshotInspector />
      <OnboardingOverlay />
    </div>
  );
}
