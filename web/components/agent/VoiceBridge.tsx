"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import {
  cancelSpeak,
  speak,
  usePushToTalk,
} from "@/lib/voice";
import { AgentFallback, applyAgentEvent, sendQuery } from "@/lib/agent-client";
import { routeIntent } from "@/lib/agent-router";

/* -------------------------------------------------------------------------
 * VoiceBridge
 *
 * Owns two cross-cutting voice concerns the rest of the UI shouldn't
 * care about:
 *
 * 1. The global `.` hold-to-talk binding. Pressing `.` anywhere on the
 *    page (when not typing in an input) starts STT. Releasing it submits
 *    the transcript to the agent — the same pipeline `/` typing uses.
 *
 * 2. Auto read-back. Whenever the agent finishes a reply
 *    (`reply.done` / `dock=speaking` complete), the dock subscribes to
 *    the reply text and pipes it through TTS. The dock listens to
 *    `dock` state to expand its surface during read-back.
 *
 * Renders no DOM. Behavioural component only.
 * ----------------------------------------------------------------------- */

export function VoiceBridge() {
  const setDock = useAgentStore((s) => s.setDock);
  const startReply = useAgentStore((s) => s.startReply);

  const submittingRef = useRef(false);
  const submitTranscript = useCallback(
    async (text: string) => {
      if (!text.trim() || submittingRef.current) return;
      submittingRef.current = true;
      // Mirror `/` typing: prime the reply pane with the user's query
      // so the dock + command bar can render it as it streams.
      startReply(text);
      try {
        await sendQuery(text);
      } catch (err) {
        if (err instanceof AgentFallback) {
          for await (const evt of routeIntent(text)) {
            applyAgentEvent(evt);
          }
        } else {
          // eslint-disable-next-line no-console
          console.error("[voice-bridge] sendQuery failed", err);
        }
      } finally {
        submittingRef.current = false;
      }
    },
    [startReply],
  );

  const ptt = usePushToTalk({ onTranscript: submitTranscript });

  /* Stable handle so the global key listeners can call into the latest
   * onPress/onRelease without re-binding. Re-binding on every ptt
   * identity change would wipe the closure-local `pressed` flag and
   * could drop a keyup that landed mid-render — leaving the mic on. */
  const pttRef = useRef(ptt);
  pttRef.current = ptt;

  // Expose for VoiceDot — the dot still wants pointer-driven hold-to-talk.
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __voice?: typeof ptt }).__voice = ptt;
  }, [ptt]);

  /* ---------- `.` hold-to-talk (installed once) --------------------- */
  useEffect(() => {
    let pressed = false;

    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        el?.isContentEditable === true
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "." || e.repeat) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      if (!pressed) {
        pressed = true;
        void pttRef.current.onPress();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ".") return;
      if (!pressed) return;
      pressed = false;
      e.preventDefault();
      void pttRef.current.onRelease();
    };
    /* Window blur (alt-tab, switch tab, focus stolen by another app)
     * counts as a release — otherwise the user comes back to a stuck
     * "listening" dot and a recorder that never stopped. */
    const onBlur = () => {
      if (!pressed) return;
      pressed = false;
      void pttRef.current.onRelease();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /* ---------- Auto read-back on reply.done -------------------------- */
  /* The agent stream sets dock="speaking" when streaming reply chunks
     and back to "idle" when done. We subscribe to the store transitions
     so we can fire TTS the moment streaming finishes. */
  useEffect(() => {
    let lastDock: string | null = null;
    let stop: (() => void) | null = null;

    const unsub = useAgentStore.subscribe((s) => {
      const next = s.dock;
      const prev = lastDock;
      lastDock = next;

      // We watch the speaking → idle edge. At that point the reply
      // text is final; play it.
      if (prev === "speaking" && next === "idle") {
        const reply = useAgentStore.getState().agentReply;
        if (!reply || !reply.trim()) return;

        useAgentStore.getState().setDock("speaking");
        stop?.();
        speak(reply, {
          onEnd: () => {
            // Restore idle once audio has finished.
            const cur = useAgentStore.getState().dock;
            if (cur === "speaking") setDock("idle");
            stop = null;
          },
        }).then((s) => {
          stop = s;
        });
      }
    });
    return () => {
      unsub();
      stop?.();
      cancelSpeak();
    };
  }, [setDock]);

  return null;
}
