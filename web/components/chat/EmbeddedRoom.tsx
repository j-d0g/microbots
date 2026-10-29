"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useAgentStore, type WindowKind } from "@/lib/store";
import { GraphRoom } from "@/components/rooms/GraphRoom";
import { AskUserCard } from "@/components/windows/AskUserCard";
import { IntegrationsWindow } from "@/components/windows/IntegrationsWindow";
import { IntegrationDetailWindow } from "@/components/windows/IntegrationDetailWindow";
import { EntitiesWindow } from "@/components/windows/EntitiesWindow";
import { EntityDetailWindow } from "@/components/windows/EntityDetailWindow";
import { MemoriesWindow } from "@/components/windows/MemoriesWindow";
import { SkillsWindow } from "@/components/windows/SkillsWindow";
import { WorkflowsWindow } from "@/components/windows/WorkflowsWindow";
import { ComposioConnectWindow } from "@/components/windows/ComposioConnectWindow";
import { WINDOW_LABEL } from "@/components/windows/registry";
import { cn } from "@/lib/cn";

const ROOM_COMPONENTS: Record<
  WindowKind,
  React.ComponentType<{ payload?: Record<string, unknown> }>
> = {
  graph: GraphRoom,
  ask_user: AskUserCard,
  integrations: IntegrationsWindow,
  integration_detail: IntegrationDetailWindow,
  entities: EntitiesWindow,
  entity_detail: EntityDetailWindow,
  memories: MemoriesWindow,
  skills: SkillsWindow,
  workflows: WorkflowsWindow,
  composio_connect: ComposioConnectWindow,
};

export function EmbeddedRoom() {
  const chatRoom = useAgentStore((s) => s.chatRoom);
  const windows = useAgentStore((s) => s.windows);
  const closeChatCanvas = useAgentStore((s) => s.closeChatCanvas);

  const activeWindow = [...windows].reverse().find((window) => window.kind === chatRoom) ?? null;

  const Room = ROOM_COMPONENTS[chatRoom];
  const payload = activeWindow?.payload ?? {};
  const isAgentOpened = activeWindow?.openedBy === "agent";

  return (
    <div className="relative flex h-full w-full flex-col bg-paper-0">
      <EmbeddedHeader
        kind={chatRoom}
        isAgentOpened={isAgentOpened}
        onClose={closeChatCanvas}
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
}: {
  kind: WindowKind;
  isAgentOpened: boolean;
  onClose: () => void;
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
    </header>
  );
}
