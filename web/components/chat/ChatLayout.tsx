"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChatPanel } from "./ChatPanel";
import { EmbeddedRoom } from "./EmbeddedRoom";
import { useAgentStore } from "@/lib/store";

export function ChatLayout() {
  const chatCanvasOpen = useAgentStore((s) => s.chatCanvasOpen);
  const closeChatCanvas = useAgentStore((s) => s.closeChatCanvas);

  useEffect(() => {
    const onPopState = () => {
      if (useAgentStore.getState().chatCanvasOpen) {
        useAgentStore.setState({ chatCanvasOpen: false });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!chatCanvasOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeChatCanvas();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatCanvasOpen, closeChatCanvas]);

  return (
    <div
      className="fixed inset-0 flex bg-paper-0"
      data-testid="chat-layout"
    >
      <main className="flex min-h-0 min-w-0 flex-1 justify-center">
        <div className="h-full w-full max-w-[720px]">
          <ChatPanel />
        </div>
      </main>
      <AnimatePresence>
        {chatCanvasOpen && (
          <motion.aside
            key="chat-canvas"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed inset-0 z-40 h-full w-full bg-paper-0 shadow-xl md:relative md:inset-auto md:z-auto md:w-[min(44vw,560px)] md:shrink-0 md:border-l md:border-rule"
            data-testid="chat-canvas"
          >
            <EmbeddedRoom />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
