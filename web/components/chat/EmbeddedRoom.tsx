"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useAgentStore, type WindowKind, type WindowState } from "@/lib/store";
import { GraphRoom } from "@/components/rooms/GraphRoom";
import { SettingsRoom } from "@/components/rooms/SettingsRoom";
import { AskUserCard } from "@/components/windows/AskUserCard";
import { ChatWindow } from "@/components/windows/ChatWindow";
import { ProfileWindow } from "@/components/windows/ProfileWindow";
import { IntegrationsWindow } from "@/components/windows/IntegrationsWindow";
import { IntegrationDetailWindow } from "@/components/windows/IntegrationDetailWindow";
import { EntitiesWindow } from "@/components/windows/EntitiesWindow";
import { EntityDetailWindow } from "@/components/windows/EntityDetailWindow";
import { MemoriesWindow } from "@/components/windows/MemoriesWindow";
import { SkillsWindow } from "@/components/windows/SkillsWindow";
import { WorkflowsWindow } from "@/components/windows/WorkflowsWindow";
import { WikiWindow } from "@/components/windows/WikiWindow";
import { ChatsSummaryWindow } from "@/components/windows/ChatsSummaryWindow";
import { ComposioConnectWindow } from "@/components/windows/ComposioConnectWindow";
import { WINDOW_LABEL } from "@/components/stage/window-labels";
import { cn } from "@/lib/cn";

const ROOM_COMPONENTS: Record<
  WindowKind,
  React.ComponentType<{ payload?: Record<string, unknown> }>
> = {
  graph: GraphRoom,
  chat: ChatWindow,
  ask_user: AskUserCard,
  settings: SettingsRoom,
  profile: ProfileWindow,
  integrations: IntegrationsWindow,
  integration_detail: IntegrationDetailWindow,
  entities: EntitiesWindow,
  entity_detail: EntityDetailWindow,
  memories: MemoriesWindow,
  skills: SkillsWindow,
  workflows: WorkflowsWindow,
  wiki: WikiWindow,
  chats_summary: ChatsSummaryWindow,
  composio_connect: ComposioConnectWindow,
};

const ROOMS: WindowKind[] = [
  "graph",
  "memories",
  "workflows",
  "skills",
  "wiki",
  "settings",
];

export function EmbeddedRoom() {
  const chatRoom = useAgentStore((s) => s.chatRoom);
  const windows = useAgentStore((s) => s.windows);
  const openChatCanvas = useAgentStore((s) => s.openChatCanvas);
  const closeChatCanvas = useAgentStore((s) => s.closeChatCanvas);

  const activeWindow = useMemo<WindowState | null>(() => {
    let best: WindowState | null = null;
    for (const w of windows) {
      if (w.kind !== chatRoom) continue;
      if (!best || w.zIndex > best.zIndex) best = w;
    }
    return best;
  }, [windows, chatRoom]);

  const Room = ROOM_COMPONENTS[chatRoom];
  const payload = activeWindow?.payload ?? {};
  const isAgentOpened = activeWindow?.openedBy === "agent";

  return (
    <div className="relative flex h-full w-full flex-col bg-paper-0">
      <EmbeddedHeader
        kind={chatRoom}
        isAgentOpened={isAgentOpened}
        onClose={closeChatCanvas}
        onPick={openChatCanvas}
      />

      <div
        className={cn(
          "muji-scroll relative flex-1 overflow-y-auto overflow-x-hidden",
          chatRoom === "graph" ? "p-0" : "",
        )}
        data-testid={`embedded-room-${chatRoom}`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={chatRoom + (activeWindow?.id ?? "dummy")}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="h-full w-full"
          >
            <Room payload={payload} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmbeddedHeader({
  kind,
  isAgentOpened,
  onClose,
  onPick,
}: {
  kind: WindowKind;
  isAgentOpened: boolean;
  onClose: () => void;
  onPick: (kind: WindowKind) => void;
}) {
  return (
    <header className="shrink-0 border-b border-rule/60">
      <div className="flex h-10 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-indigo/80" />
          <span
            className="truncate font-mono text-[10px] uppercase tracking-[0.10em] text-ink-60"
            data-testid="embedded-room-label"
          >
            {WINDOW_LABEL[kind] ?? kind}
          </span>
          {isAgentOpened && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
              · by agent
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close canvas"
          title="close canvas"
          data-testid="embedded-room-close"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-sm",
            "text-ink-35 transition-colors duration-150",
            "hover:bg-paper-2 hover:text-ink-90",
          )}
        >
          <X size={12} strokeWidth={1.6} />
        </button>
      </div>
      <nav
        className="muji-scroll flex gap-4 overflow-x-auto px-4 pb-2"
        data-testid="chat-room-tabs"
        role="tablist"
        aria-label="chat canvas rooms"
      >
        {ROOMS.map((room) => (
          <button
            key={room}
            type="button"
            role="tab"
            aria-selected={room === kind}
            data-active={room === kind}
            data-testid={`chat-tab-${room}`}
            onClick={() => onPick(room)}
            className={cn(
              "shrink-0 border-b pb-1 font-mono text-[9px] uppercase tracking-[0.1em]",
              room === kind
                ? "border-accent-indigo text-ink-90"
                : "border-transparent text-ink-35 hover:text-ink-60",
            )}
          >
            {WINDOW_LABEL[room] ?? room}
          </button>
        ))}
      </nav>
    </header>
  );
}
