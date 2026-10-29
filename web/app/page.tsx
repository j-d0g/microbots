"use client";

import { CardStack } from "@/components/cards/CardStack";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { AgentBridge } from "@/components/agent/AgentBridge";
import { StoreBridge } from "@/components/agent/StoreBridge";
import { VoiceBridge } from "@/components/agent/VoiceBridge";

export default function Home() {
  return (
    <div className="relative min-h-dvh bg-paper-0 text-ink-90">
      <StoreBridge />
      <AgentBridge />
      <VoiceBridge />
      <ChatLayout />
      <CardStack />
    </div>
  );
}
