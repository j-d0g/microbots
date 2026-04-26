"use client";

import { useAgentStore } from "./store";
import type { IntentSummary } from "./intent-router";

export function useConversationHandlers() {
  const store = useAgentStore();

  return {
    handleNavigate: (target: string) => {
      console.log("[handlers] Opening window:", target);
      const validTargets = ["graph", "chat", "entities", "memories", "skills", "workflows", "integrations", "wiki", "settings", "profile"];
      if (validTargets.includes(target)) {
        store.openWindow(target as any);
        store.setChatRoom(target as any);
      }
    },

    handleConfirm: (id: string) => {
      console.log("[handlers] Confirming:", id);
      store.resolveConfirm(id, true);
    },

    handleCancel: (id: string) => {
      console.log("[handlers] Canceling:", id);
      store.resolveConfirm(id, false);
    },

    handleQuery: (query: string) => {
      console.log("[handlers] Query:", query);
      store.openWindow("chat");
      // Could trigger a search here
    }
  };
}
