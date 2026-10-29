"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import {
  cancelSpeak,
  speak,
  usePushToTalk,
  useVoiceConfig,
} from "@/lib/voice";
import { sendQuery } from "@/lib/agent-client";
import { createLiveVoice, type LiveVoiceState } from "@/lib/voice-live";

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
  const cfg = useVoiceConfig();

  const submittingRef = useRef(false);
  const liveActiveRef = useRef(false);
  const liveRef = useRef<ReturnType<typeof createLiveVoice> | null>(null);

  const runVoiceTurn = useCallback(
    async (text: string, { recordUser }: { recordUser: boolean }) => {
      if (!text.trim()) return "";
      // Mirror `/` typing: prime the reply pane with the user's query
      // so the dock + command bar can render it as it streams.
      startReply(text);
      if (recordUser) {
        const now = Date.now();
        const store = useAgentStore.getState();
        store.appendChatMessage({
          id: `user-${now}`,
          role: "user",
          text,
          ts: now,
          room: store.chatRoom,
        });
      }
      try {
        await sendQuery(text);
      } catch (err) {
        console.error("[voice-bridge] sendQuery failed", err);
      }
      return useAgentStore.getState().agentReply;
    },
    [startReply],
  );

  const submitTranscript = useCallback(
    async (text: string) => {
      if (!text.trim() || submittingRef.current) return;
      submittingRef.current = true;
      try {
        await runVoiceTurn(text, { recordUser: true });
      } finally {
        submittingRef.current = false;
      }
    },
    [runVoiceTurn],
  );

  const getLiveVoice = useCallback(() => {
    if (!cfg.live) return null;
    if (!liveRef.current) {
      const mapState = (state: LiveVoiceState) => {
        liveActiveRef.current = state !== "idle" && state !== "error";
        const dockState =
          state === "connecting" || state === "thinking"
            ? "thinking"
            : state === "listening"
              ? "listening"
              : state === "speaking"
                ? "speaking"
                : "idle";
        useAgentStore.getState().setDock(dockState);
      };
      liveRef.current = createLiveVoice({
        runAgentTurn: (text) => runVoiceTurn(text, { recordUser: false }),
        onUserUtterance: (text) => {
          const now = Date.now();
          const store = useAgentStore.getState();
          store.appendChatMessage({
            id: `user-${now}`,
            role: "user",
            text,
            ts: now,
            room: store.chatRoom,
          });
        },
        onAssistantUtterance: (text) => {
          const now = Date.now();
          const store = useAgentStore.getState();
          store.appendChatMessage({
            id: `agent-${now}`,
            role: "agent",
            text,
            ts: now,
            room: store.chatRoom,
            status: "done",
          });
        },
        onCaption: (who, text) => {
          if (who !== "user") return;
          const store = useAgentStore.getState();
          store.clearTranscript();
          store.appendTranscript(text);
        },
        onState: mapState,
        onError: (message) => {
          useAgentStore.getState().setAgentStatus(message);
        },
      });
    }
    return liveRef.current;
  }, [cfg.live, runVoiceTurn]);

  const ptt = usePushToTalk({ onTranscript: submitTranscript });

  /* Stable handle so the global key listeners can call into the latest
   * onPress/onRelease without re-binding. Re-binding on every ptt
   * identity change would wipe the closure-local `pressed` flag and
   * could drop a keyup that landed mid-render — leaving the mic on. */
  const pttRef = useRef(ptt);
  pttRef.current = ptt;

  // The chat microphone uses pointer-driven hold-to-talk.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = {
      ...ptt,
      live: cfg.live,
      toggleLive: () => {
        const live = getLiveVoice();
        if (!live) return;
        if (live.state === "idle" || live.state === "error") {
          void live.start();
        } else {
          void live.stop();
        }
      },
    };
    (window as unknown as { __voice?: typeof handle }).__voice = handle;
    window.dispatchEvent(new Event("voice-handle-change"));
    return () => {
      const target = window as unknown as { __voice?: typeof handle };
      if (target.__voice === handle) {
        delete target.__voice;
        window.dispatchEvent(new Event("voice-handle-change"));
      }
    };
  }, [ptt, cfg.live, getLiveVoice]);

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
      if (e.key === "Escape") {
        if (liveActiveRef.current && !isTyping(e.target)) {
          e.preventDefault();
          void liveRef.current?.stop();
        }
        return;
      }
      if (e.key !== "." || e.repeat || liveActiveRef.current) return;
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

  useEffect(
    () => () => {
      void liveRef.current?.stop();
    },
    [],
  );

  /* ---------- Auto read-back on reply.done --------------------------
   *
   * The agent stream sets dock="speaking" (or stays "thinking") while it
   * streams a reply, then back to "idle" when done. We watch that edge to
   * start TTS.
   *
   * Important: TTS playback itself toggles the dock (we set "speaking"
   * for the audio's duration, then "idle" on `onEnd`). Without a guard
   * the second speaking → idle would re-trigger another speak(), which
   * sets speaking again, etc — an infinite loop.
   *
   * Guard: every reply lives under a single `lastQuery`. We remember
   * the query we last spoke for and never speak the same one twice.
   * A new agent turn (`startReply` mutates `lastQuery`) is the only
   * thing that re-arms playback. */
  useEffect(() => {
    let lastDock: string | null = useAgentStore.getState().dock;
    let stop: (() => void) | null = null;
    let lastSpokenQuery: string | null = null;
    let speaking = false;

    const unsub = useAgentStore.subscribe((s) => {
      const next = s.dock;
      const prev = lastDock;
      lastDock = next;

      // Server turns go thinking → speaking → idle; local-router turns
      // go thinking → idle. Both end a reply.
      if ((prev === "speaking" || prev === "thinking") && next === "idle") {
        // Skip transitions caused by our own TTS finishing.
        if (speaking) {
          speaking = false;
          return;
        }
        if (liveActiveRef.current) return;
        const reply = s.agentReply;
        const query = s.lastQuery;
        if (!reply || !reply.trim()) return;
        if (!query || query === lastSpokenQuery) return;

        lastSpokenQuery = query;
        speaking = true;
        useAgentStore.getState().setDock("speaking");
        stop?.();
        speak(reply, {
          onEnd: () => {
            stop = null;
            // Only step back to idle if nothing else has progressed
            // the state machine in the meantime.
            if (useAgentStore.getState().dock === "speaking") {
              setDock("idle");
            }
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
