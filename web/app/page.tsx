"use client";

import { FloatingDock } from "@/components/dock/FloatingDock";
import { CardStack } from "@/components/cards/CardStack";
import { CommandBar } from "@/components/command/CommandBar";
import { Desktop } from "@/components/stage/Desktop";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { AgentBridge } from "@/components/agent/AgentBridge";
import { StoreBridge } from "@/components/agent/StoreBridge";
// SnapshotInspector retired — the canvas snapshot it surfaced is no
// longer informative now that windows are schema-driven. Re-import
// and re-mount if a debug surface is needed again.
// import { SnapshotInspector } from "@/components/agent/SnapshotInspector";
import { VoiceBridge } from "@/components/agent/VoiceBridge";
import { ConversationBridge } from "@/components/agent/ConversationBridge";
import { ConversationDebugger } from "@/components/agent/ConversationDebugger";
import { OnboardingOverlay } from "@/components/onboarding/OnboardingOverlay";
import { useAgentStore } from "@/lib/store";

export default function Home() {
  const uiMode = useAgentStore((s) => s.uiMode);
  const conversationMode = useAgentStore((s) => s.conversationMode);

  if (uiMode === "chat") {
    return (
      <div className="relative min-h-dvh bg-paper-0 text-ink-90">
        <StoreBridge />
        <AgentBridge />
        {/* VoiceBridge: handles push-to-talk (`.` key) and TTS read-back */}
        <VoiceBridge />
        {/* ConversationBridge: handles continuous conversation mode (VAD) */}
        {conversationMode && <ConversationBridge />}
        {/* ConversationDebugger: shows in dev mode only */}
        <ConversationDebugger />
        <ChatLayout />
        <CardStack />
        <OnboardingOverlay />
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh bg-paper-0 text-ink-90">
      <StoreBridge />
      <AgentBridge />
      {/* VoiceBridge: handles push-to-talk (`.` key) and TTS read-back */}
      <VoiceBridge />
      {/* ConversationBridge: handles continuous conversation mode (VAD) */}
      {conversationMode && <ConversationBridge />}
      {/* ConversationDebugger: shows in dev mode only */}
      <ConversationDebugger />
      <Desktop />
      <CardStack />
      <FloatingDock />
      <CommandBar />
      <OnboardingOverlay />
    </div>
  );
}
