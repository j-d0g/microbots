export type LiveVoiceState =
  | "connecting"
  | "listening"
  | "speaking"
  | "thinking"
  | "idle"
  | "error";

export type LiveServerEvent =
  | { type: "session.started"; session: { id: string } }
  | {
      type: "session.closed";
      reason?: string;
      usage?: { seconds?: number };
    }
  | {
      type: "session.input_transcript.delta";
      delta: string;
      start_ms?: number;
      end_ms?: number;
    }
  | {
      type: "session.output_transcript.delta";
      delta: string;
      start_ms?: number;
      end_ms?: number;
    }
  | {
      type: "session.delegation.created";
      offset_ms?: number;
      delegation: { id: string; type?: string; target?: string };
    }
  | {
      type: "session.commentary.appended" | "session.thinking.appended";
      client_event_id?: string;
    }
  | {
      type: "error";
      error: {
        type?: string;
        code?: string | null;
        message?: string;
        param?: string | null;
        client_event_id?: string | null;
      };
    }
  | { type: "unknown"; raw: { type?: unknown } };

export const MAX_APPEND_CHARS = 1800;
let eventCounter = 0;

function nextLiveEventId() {
  eventCounter++;
  return `mb_${Date.now().toString(36)}_${eventCounter.toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return value[key] === undefined || typeof value[key] === "string";
}

function optionalNullableString(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return (
    value[key] === undefined ||
    value[key] === null ||
    typeof value[key] === "string"
  );
}

function optionalNumber(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return value[key] === undefined || typeof value[key] === "number";
}

export function parseLiveEvent(data: string): LiveServerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const unknown: LiveServerEvent = {
    type: "unknown",
    raw: { type: value.type },
  };
  if (typeof value.type !== "string") return unknown;

  switch (value.type) {
    case "session.started":
      return isRecord(value.session) && typeof value.session.id === "string"
        ? { type: "session.started", session: { id: value.session.id } }
        : unknown;
    case "session.closed": {
      if (!optionalString(value, "reason")) return unknown;
      if (
        value.usage !== undefined &&
        (!isRecord(value.usage) || !optionalNumber(value.usage, "seconds"))
      ) {
        return unknown;
      }
      const event: Extract<LiveServerEvent, { type: "session.closed" }> = {
        type: "session.closed",
      };
      if (typeof value.reason === "string") event.reason = value.reason;
      if (isRecord(value.usage)) {
        event.usage = {};
        if (typeof value.usage.seconds === "number") {
          event.usage.seconds = value.usage.seconds;
        }
      }
      return event;
    }
    case "session.input_transcript.delta":
    case "session.output_transcript.delta":
      if (
        typeof value.delta !== "string" ||
        !optionalNumber(value, "start_ms") ||
        !optionalNumber(value, "end_ms")
      ) {
        return unknown;
      }
      return {
        type: value.type,
        delta: value.delta,
        ...(typeof value.start_ms === "number"
          ? { start_ms: value.start_ms }
          : {}),
        ...(typeof value.end_ms === "number" ? { end_ms: value.end_ms } : {}),
      };
    case "session.delegation.created":
      if (
        !isRecord(value.delegation) ||
        typeof value.delegation.id !== "string" ||
        !optionalString(value.delegation, "type") ||
        !optionalString(value.delegation, "target") ||
        !optionalNumber(value, "offset_ms")
      ) {
        return unknown;
      }
      return {
        type: "session.delegation.created",
        delegation: {
          id: value.delegation.id,
          ...(typeof value.delegation.type === "string"
            ? { type: value.delegation.type }
            : {}),
          ...(typeof value.delegation.target === "string"
            ? { target: value.delegation.target }
            : {}),
        },
        ...(typeof value.offset_ms === "number"
          ? { offset_ms: value.offset_ms }
          : {}),
      };
    case "session.commentary.appended":
    case "session.thinking.appended":
      return optionalString(value, "client_event_id")
        ? {
            type: value.type,
            ...(typeof value.client_event_id === "string"
              ? { client_event_id: value.client_event_id }
              : {}),
          }
        : unknown;
    case "error":
      if (!isRecord(value.error)) return unknown;
      if (
        !optionalString(value.error, "type") ||
        !optionalString(value.error, "message") ||
        !optionalNullableString(value.error, "code") ||
        !optionalNullableString(value.error, "param") ||
        !optionalNullableString(value.error, "client_event_id")
      ) {
        return unknown;
      }
      return {
        type: "error",
        error: {
          ...(typeof value.error.type === "string"
            ? { type: value.error.type }
            : {}),
          ...(typeof value.error.code === "string" ||
          value.error.code === null
            ? { code: value.error.code }
            : {}),
          ...(typeof value.error.message === "string"
            ? { message: value.error.message }
            : {}),
          ...(typeof value.error.param === "string" || value.error.param === null
            ? { param: value.error.param }
            : {}),
          ...(typeof value.error.client_event_id === "string" ||
          value.error.client_event_id === null
            ? { client_event_id: value.error.client_event_id }
            : {}),
        },
      };
    default:
      return unknown;
  }
}

export interface LiveControllerOptions {
  send: (event: Record<string, unknown>) => void;
  runAgentTurn: (text: string) => Promise<string>;
  onUserUtterance?: (text: string) => void;
  onAssistantUtterance?: (text: string) => void;
  onCaption?: (who: "user" | "assistant", text: string) => void;
  onState?: (state: LiveVoiceState) => void;
  onError?: (message: string) => void;
  utteranceGapMs?: number;
  speakingGapMs?: number;
}

export function createLiveController(opts: LiveControllerOptions) {
  const utteranceGapMs = opts.utteranceGapMs ?? 700;
  const speakingGapMs = opts.speakingGapMs ?? 900;
  let state: LiveVoiceState = "connecting";
  let isReady = false;
  let sessionId: string | null = null;
  let disposed = false;
  let closed = false;
  let inputBuffer = "";
  let outputBuffer = "";
  let inputTimer: ReturnType<typeof setTimeout> | null = null;
  let outputTimer: ReturnType<typeof setTimeout> | null = null;
  let latestUtterance: { text: string; consumed: boolean } | null = null;
  let delegatedSinceUtterance = false;
  let pendingDelegations = 0;
  let delegationChain: Promise<void> = Promise.resolve();

  const deriveState = (): LiveVoiceState => {
    if (!isReady) return "connecting";
    if (outputTimer !== null) return "speaking";
    if (pendingDelegations > 0) return "thinking";
    return "listening";
  };

  const updateState = (force = false) => {
    if (disposed) return;
    const next = closed ? "idle" : deriveState();
    if (next !== state) {
      state = next;
      opts.onState?.(state);
    } else if (force) {
      opts.onState?.(state);
    }
  };

  opts.onState?.(state);

  const finalizeUser = () => {
    if (inputTimer !== null) clearTimeout(inputTimer);
    inputTimer = null;
    const text = inputBuffer.trim();
    inputBuffer = "";
    if (!text || disposed) return;
    latestUtterance = { text, consumed: false };
    delegatedSinceUtterance = false;
    opts.onUserUtterance?.(text);
  };

  const sendDelegationReply = async (
    delegationId: string,
    text: string | null,
  ) => {
    let content: string;
    if (text === null) {
      content = "I didn't catch the request. Ask the user to say it again.";
    } else {
      try {
        content = (await opts.runAgentTurn(text)).trim();
        if (!content) content = "Done. The result is on screen.";
      } catch (error) {
        content = "That didn't work: the workspace agent hit an error.";
        try {
          opts.onError?.(
            error instanceof Error ? error.message : "Workspace agent error",
          );
        } catch (callbackError) {
          console.warn("[voice/live] error callback failed", callbackError);
        }
      }
    }

    if (!disposed) {
      try {
        opts.send({
          type: "session.commentary.append",
          event_id: nextLiveEventId(),
          delegation_id: delegationId,
          content: content.slice(0, MAX_APPEND_CHARS),
        });
      } catch (error) {
        try {
          opts.onError?.(
            error instanceof Error ? error.message : "Could not send live reply",
          );
        } catch (callbackError) {
          console.warn("[voice/live] error callback failed", callbackError);
        }
      }
    }
    pendingDelegations = Math.max(0, pendingDelegations - 1);
    updateState(true);
  };

  const handleEvent = (event: LiveServerEvent) => {
    if (disposed) return;
    switch (event.type) {
      case "session.started":
        sessionId = event.session.id;
        isReady = true;
        closed = false;
        updateState();
        return;
      case "session.closed":
        closed = true;
        isReady = false;
        if (inputTimer !== null) clearTimeout(inputTimer);
        if (outputTimer !== null) clearTimeout(outputTimer);
        inputTimer = null;
        outputTimer = null;
        inputBuffer = "";
        outputBuffer = "";
        updateState();
        return;
      case "session.input_transcript.delta":
        inputBuffer += event.delta;
        opts.onCaption?.("user", inputBuffer.trim());
        if (inputTimer !== null) clearTimeout(inputTimer);
        inputTimer = setTimeout(finalizeUser, utteranceGapMs);
        return;
      case "session.output_transcript.delta":
        outputBuffer += event.delta;
        opts.onCaption?.("assistant", outputBuffer.trim());
        if (outputTimer !== null) clearTimeout(outputTimer);
        outputTimer = setTimeout(() => {
          outputTimer = null;
          const text = outputBuffer.trim();
          outputBuffer = "";
          if (text && !delegatedSinceUtterance) {
            opts.onAssistantUtterance?.(text);
          }
          updateState();
        }, speakingGapMs);
        updateState();
        return;
      case "session.delegation.created": {
        if (inputTimer !== null || inputBuffer) finalizeUser();
        const utterance =
          latestUtterance && !latestUtterance.consumed
            ? latestUtterance
            : null;
        if (utterance) utterance.consumed = true;
        delegatedSinceUtterance = true;
        const text = utterance?.text ?? null;
        pendingDelegations++;
        updateState();
        delegationChain = delegationChain.then(() =>
          sendDelegationReply(event.delegation.id, text),
        );
        return;
      }
      case "error": {
        const message = event.error.message ?? "live session error";
        console.warn("[voice/live] session error", message);
        opts.onError?.(message);
        return;
      }
      case "session.commentary.appended":
      case "session.thinking.appended":
      case "unknown":
        return;
    }
  };

  return {
    handleMessage(data: string) {
      const event = parseLiveEvent(data);
      if (event) handleEvent(event);
    },
    handleEvent,
    get ready() {
      return isReady;
    },
    get sessionId() {
      return sessionId;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (inputTimer !== null) clearTimeout(inputTimer);
      if (outputTimer !== null) clearTimeout(outputTimer);
      inputTimer = null;
      outputTimer = null;
    },
  };
}

export interface LiveVoiceOptions
  extends Omit<LiveControllerOptions, "send"> {
  endpoint?: string;
  deps?: {
    fetch?: typeof fetch;
    getUserMedia?: (
      constraints: MediaStreamConstraints,
    ) => Promise<MediaStream>;
    createPeerConnection?: () => RTCPeerConnection;
    createAudio?: () => HTMLAudioElement;
  };
}

export function createLiveVoice(opts: LiveVoiceOptions) {
  let state: LiveVoiceState = "idle";
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let stream: MediaStream | null = null;
  let audio: HTMLAudioElement | null = null;
  let controller: ReturnType<typeof createLiveController> | null = null;
  let disposedGeneration = 0;
  let sessionClosed = false;
  let closing = false;
  let resolveSessionClosed: (() => void) | null = null;
  let iceGatheringTimeout: ReturnType<typeof setTimeout> | null = null;

  const setState = (next: LiveVoiceState) => {
    if (state === next) return;
    state = next;
    opts.onState?.(next);
  };

  const cleanup = () => {
    disposedGeneration++;
    if (iceGatheringTimeout !== null) {
      clearTimeout(iceGatheringTimeout);
      iceGatheringTimeout = null;
    }
    const oldController = controller;
    controller = null;
    oldController?.dispose();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (dc) {
      dc.onmessage = null;
      dc.onclose = null;
      dc.close();
      dc = null;
    }
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.onicegatheringstatechange = null;
      pc.close();
      pc = null;
    }
    if (audio) {
      audio.srcObject = null;
      audio = null;
    }
    sessionClosed = false;
    closing = false;
    resolveSessionClosed = null;
    setState("idle");
  };

  const fail = (error: unknown, generation: number) => {
    if (generation !== disposedGeneration) return;
    const message =
      error instanceof Error ? error.message : "Live voice failed";
    cleanup();
    setState("error");
    opts.onError?.(message);
  };

  const waitForIceGathering = (
    connection: RTCPeerConnection,
  ): Promise<void> => {
    if (connection.iceGatheringState === "complete") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      iceGatheringTimeout = setTimeout(() => {
        iceGatheringTimeout = null;
        connection.onicegatheringstatechange = null;
        reject(new Error("ICE gathering timed out"));
      }, 10_000);
      connection.onicegatheringstatechange = () => {
        if (connection.iceGatheringState !== "complete") return;
        if (iceGatheringTimeout !== null) {
          clearTimeout(iceGatheringTimeout);
          iceGatheringTimeout = null;
        }
        connection.onicegatheringstatechange = null;
        resolve();
      };
    });
  };

  const send = (event: Record<string, unknown>) => {
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify(event));
    } else {
      console.warn("[voice/live] dropped event; data channel is not open");
    }
  };

  return {
    async start() {
      if (state !== "idle" && state !== "error") return;
      const generation = disposedGeneration;
      setState("connecting");
      controller = createLiveController({
        ...opts,
        send,
        onState: setState,
      });
      try {
        pc =
          opts.deps?.createPeerConnection?.() ??
          new RTCPeerConnection();
        const connection = pc;
        audio = opts.deps?.createAudio?.() ?? document.createElement("audio");
        audio.autoplay = true;
        connection.ontrack = (event) => {
          if (!audio) return;
          audio.srcObject = new MediaStream([event.track]);
          void audio.play().catch((error: unknown) => {
            console.warn("[voice/live] audio playback failed", error);
          });
        };
        connection.onconnectionstatechange = () => {
          if (
            connection === pc &&
            connection.connectionState === "failed"
          ) {
            fail(new Error("Live voice connection failed"), generation);
          }
        };

        stream = await (
          opts.deps?.getUserMedia ??
          ((constraints) => navigator.mediaDevices.getUserMedia(constraints))
        )({ audio: true });
        if (generation !== disposedGeneration) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getAudioTracks().forEach((track) => connection.addTrack(track, stream!));

        dc = connection.createDataChannel("oai-events");
        const channel = dc;
        channel.onmessage = (event) => {
          const parsed = parseLiveEvent(String(event.data));
          if (!parsed) return;
          controller?.handleEvent(parsed);
          if (parsed.type === "session.closed") {
            sessionClosed = true;
            resolveSessionClosed?.();
            if (!closing && channel === dc) cleanup();
          }
        };
        channel.onclose = () => {
          if (channel === dc && !sessionClosed) cleanup();
        };

        const offer = await connection.createOffer();
        if (generation !== disposedGeneration) return;
        await connection.setLocalDescription(offer);
        if (generation !== disposedGeneration) return;
        await waitForIceGathering(connection);
        if (generation !== disposedGeneration) return;
        const localSdp = connection.localDescription?.sdp;
        if (!localSdp) throw new Error("WebRTC offer has no SDP");
        const response = await (opts.deps?.fetch ?? fetch)(
          opts.endpoint ?? "/api/voice/live",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sdp: localSdp }),
          },
        );
        const result = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          transport?: { sdp?: unknown };
        };
        if (generation !== disposedGeneration) return;
        if (!response.ok) {
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : String(response.status),
          );
        }
        if (typeof result.transport?.sdp !== "string") {
          throw new Error("Live session response has no answer SDP");
        }
        await connection.setRemoteDescription({
          type: "answer",
          sdp: result.transport.sdp,
        });
      } catch (error) {
        fail(error, generation);
      }
    },
    async stop() {
      if (controller?.ready && dc?.readyState === "open") {
        closing = true;
        const closed = new Promise<void>((resolve) => {
          resolveSessionClosed = resolve;
        });
        send({ type: "session.close", event_id: nextLiveEventId() });
        let timeout: ReturnType<typeof setTimeout> | null = null;
        await Promise.race([
          closed,
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 5_000);
          }),
        ]);
        if (timeout !== null) clearTimeout(timeout);
      }
      cleanup();
    },
    get state() {
      return state;
    },
  };
}
