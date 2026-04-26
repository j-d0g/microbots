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
import { WINDOW_LABEL } from "@/components/stage/window-labels";
import { getDummyPayload } from "@/lib/chat-dummy-payloads";
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
};

/**
 * Single-window pane for chat mode.
 *
 * The agent (and the user, via tabs) are constrained to one focal
 * window at a time. We pick the topmost non-minimised window of the
 * active `chatRoom` kind and render the same component used in the
 * windowed Stage Manager — so visual fidelity stays 1:1 across modes.
 *
 * If no real window exists yet (e.g. a tab was clicked before any
 * agent traffic landed), we still render the component with a
 * lightweight dummy payload so the user sees representative content.
 *
 * Header chrome is intentionally muted — a focus dot, the room label,
 * and a soft close affordance — to match the `CentreFrame` aesthetic
 * without competing with the chat panel on the left.
 */
export function EmbeddedRoom() {
  const chatRoom = useAgentStore((s) => s.chatRoom);
  const windows = useAgentStore((s) => s.windows);
  const closeWindow = useAgentStore((s) => s.closeWindow);

  // Topmost visible window of the active room kind. The same kind
  // can appear multiple times across the windowed canvas (e.g. two
  // run_code windows for two tasks); chat mode collapses that to the
  // most recently focused one.
  const activeWindow = useMemo<WindowState | null>(() => {
    let best: WindowState | null = null;
    for (const w of windows) {
      if (w.minimized) continue;
      if (w.kind !== chatRoom) continue;
      if (!best || w.zIndex > best.zIndex) best = w;
    }
    return best;
  }, [windows, chatRoom]);

  const Room = ROOM_COMPONENTS[chatRoom];
  const payload = activeWindow?.payload ?? getDummyPayload(chatRoom);
  const isAgentOpened = activeWindow?.openedBy === "agent";

  return (
    <div className="relative flex h-full w-full flex-col bg-paper-0">
      <EmbeddedHeader
        kind={chatRoom}
        isAgentOpened={isAgentOpened}
        canClose={Boolean(activeWindow)}
        onClose={activeWindow ? () => closeWindow(activeWindow.id) : undefined}
      />

      {/* Body. Rooms set their own padding via the WindowFrame in
          windowed mode; here we apply equivalent padding ourselves so
          the layouts stay visually identical. The graph room manages
          its own canvas overflow. */}
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

/* ---------- header ---------- */

function EmbeddedHeader({
  kind,
  isAgentOpened,
  canClose,
  onClose,
}: {
  kind: WindowKind;
  isAgentOpened: boolean;
  canClose: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-9 shrink-0 select-none items-center justify-between border-b border-rule/60 px-5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
            "bg-accent-indigo/80",
          )}
        />
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

      {canClose && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="close window"
          title="close window"
          data-testid="embedded-room-close"
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-sm",
            "text-ink-35 transition-colors duration-150",
            "hover:bg-paper-2 hover:text-ink-90",
          )}
        >
          <X size={11} strokeWidth={1.6} />
        </button>
      )}
    </div>
  );
}
