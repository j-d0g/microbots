import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postLiveSession } from "../../app/api/voice/live/route";
import {
  DEFAULT_LIVE_VOICE,
  LIVE_INSTRUCTIONS,
  LIVE_MODEL,
} from "../../app/api/voice/live-session";
import {
  createLiveController,
  createLiveVoice,
  MAX_APPEND_CHARS,
  parseLiveEvent,
} from "../../lib/voice-live";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function liveRequest(body: unknown, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/voice/live", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("live voice route", () => {
  it("returns unavailable without a key after validating origin and SDP", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await postLiveSession(liveRequest({ sdp: "v=0..." }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "OPENAI_API_KEY not set; live voice unavailable.",
    });
  });

  it("rejects unexpected origins and missing SDP", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const badOrigin = await postLiveSession(
      liveRequest({ sdp: "v=0..." }, "https://untrusted.example"),
    );
    const missingSdp = await postLiveSession(liveRequest({}));

    expect(badOrigin.status).toBe(403);
    expect(await badOrigin.json()).toEqual({
      error: "Unexpected request origin",
    });
    expect(missingSdp.status).toBe(400);
    expect(await missingSdp.json()).toEqual({
      error: "An SDP offer is required",
    });
  });

  it("rejects SDP larger than 64 KB", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const response = await postLiveSession(
      liveRequest({ sdp: `v=0${"x".repeat(64 * 1024)}` }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "An SDP offer is required",
    });
  });

  it("sends the documented client-delegation session request and returns the answer", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_LIVE_VOICE", "");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        session: { id: "session_1" },
        transport: { sdp: "answer-sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postLiveSession(liveRequest({ sdp: "v=0..." }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/live/sessions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer sk-test",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      session: {
        model: LIVE_MODEL,
        instructions: LIVE_INSTRUCTIONS,
        audio: { output: { voice: DEFAULT_LIVE_VOICE } },
        delegation: { type: "client" },
      },
      transport: { type: "webrtc", sdp: "v=0..." },
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      session: { id: "session_1" },
      transport: { type: "webrtc", sdp: "answer-sdp" },
    });
  });

  it("uses OPENAI_LIVE_VOICE and preserves upstream client errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_LIVE_VOICE", "vesper");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        session: { id: "session_2" },
        transport: { sdp: "answer-sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await postLiveSession(liveRequest({ sdp: "v=0..." }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).session.audio)
      .toEqual({ output: { voice: "vesper" } });

    fetchMock.mockResolvedValueOnce(new Response("secret upstream body", { status: 401 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rejected = await postLiveSession(liveRequest({ sdp: "v=0..." }));

    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({
      error: "Live session creation failed",
    });
  });
});

describe("live voice event parsing", () => {
  it("parses supported server events and preserves malformed or unknown types", () => {
    expect(
      parseLiveEvent(JSON.stringify({ type: "session.started", session: { id: "s1" } })),
    ).toEqual({ type: "session.started", session: { id: "s1" } });
    expect(
      parseLiveEvent(
        JSON.stringify({
          type: "session.input_transcript.delta",
          delta: "hello",
          start_ms: 1,
          end_ms: 2,
        }),
      ),
    ).toMatchObject({ type: "session.input_transcript.delta", delta: "hello" });
    expect(
      parseLiveEvent(
        JSON.stringify({ type: "session.output_transcript.delta", delta: "there" }),
      ),
    ).toEqual({ type: "session.output_transcript.delta", delta: "there" });
    expect(
      parseLiveEvent(
        JSON.stringify({
          type: "session.delegation.created",
          delegation: { id: "d1", type: "workspace" },
        }),
      ),
    ).toEqual({
      type: "session.delegation.created",
      delegation: { id: "d1", type: "workspace" },
    });
    expect(
      parseLiveEvent(
        JSON.stringify({
          type: "error",
          error: {
            message: "rejected",
            code: null,
            client_event_id: null,
          },
        }),
      ),
    ).toEqual({
      type: "error",
      error: { code: null, message: "rejected", client_event_id: null },
    });
    expect(parseLiveEvent("not-json")).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ type: "other.event" }))).toEqual({
      type: "unknown",
      raw: { type: "other.event" },
    });
    expect(
      parseLiveEvent(
        JSON.stringify({
          type: "session.delegation.created",
          delegation: {},
        }),
      ),
    ).toEqual({
      type: "unknown",
      raw: { type: "session.delegation.created" },
    });
  });
});

describe("live voice controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups user transcript deltas and returns one delegated agent reply", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const runAgentTurn = vi.fn().mockResolvedValue("graph is open.");
    const onUserUtterance = vi.fn();
    const states: string[] = [];
    const controller = createLiveController({
      send,
      runAgentTurn,
      onUserUtterance,
      onState: (state) => states.push(state),
    });

    controller.handleEvent({
      type: "session.started",
      session: { id: "session_1" },
    });
    controller.handleEvent({
      type: "session.input_transcript.delta",
      delta: "show me",
    });
    controller.handleEvent({
      type: "session.input_transcript.delta",
      delta: " the graph",
    });
    controller.handleEvent({
      type: "session.delegation.created",
      delegation: { id: "item_1" },
    });
    await flushPromises();

    expect(onUserUtterance).toHaveBeenCalledExactlyOnceWith("show me the graph");
    expect(runAgentTurn).toHaveBeenCalledExactlyOnceWith("show me the graph");
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "session.commentary.append",
      event_id: expect.stringMatching(/^mb_/),
      delegation_id: "item_1",
      content: "graph is open.",
    });
    expect(states).toEqual([
      "connecting",
      "listening",
      "thinking",
      "listening",
    ]);
    controller.dispose();
  });

  it("drops assistant acknowledgements after delegation and records direct replies", async () => {
    vi.useFakeTimers();
    const onAssistantUtterance = vi.fn();
    const controller = createLiveController({
      send: vi.fn(),
      runAgentTurn: vi.fn().mockResolvedValue("done"),
      onAssistantUtterance,
      speakingGapMs: 900,
    });
    controller.handleEvent({
      type: "session.started",
      session: { id: "session_1" },
    });
    controller.handleEvent({
      type: "session.delegation.created",
      delegation: { id: "item_1" },
    });
    await flushPromises();
    controller.handleEvent({
      type: "session.output_transcript.delta",
      delta: "I'll pull that up.",
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(onAssistantUtterance).not.toHaveBeenCalled();

    const directController = createLiveController({
      send: vi.fn(),
      runAgentTurn: vi.fn().mockResolvedValue("done"),
      onAssistantUtterance,
      speakingGapMs: 900,
    });
    directController.handleEvent({
      type: "session.started",
      session: { id: "session_2" },
    });
    directController.handleEvent({
      type: "session.output_transcript.delta",
      delta: "Hello there.",
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(onAssistantUtterance).toHaveBeenCalledExactlyOnceWith("Hello there.");
    controller.dispose();
    directController.dispose();
  });

  it("uses fallback commentary for empty and failed agent turns", async () => {
    const emptySend = vi.fn();
    const emptyController = createLiveController({
      send: emptySend,
      runAgentTurn: vi.fn().mockResolvedValue("  "),
    });
    emptyController.handleEvent({
      type: "session.started",
      session: { id: "session_1" },
    });
    emptyController.handleEvent({
      type: "session.input_transcript.delta",
      delta: "open the graph",
    });
    emptyController.handleEvent({
      type: "session.delegation.created",
      delegation: { id: "empty" },
    });
    await flushPromises();
    expect(emptySend).toHaveBeenCalledWith(
      expect.objectContaining({
        delegation_id: "empty",
        content: "Done. The result is on screen.",
      }),
    );

    const failureSend = vi.fn();
    const onError = vi.fn();
    const failedController = createLiveController({
      send: failureSend,
      runAgentTurn: vi.fn().mockRejectedValue(new Error("agent failure")),
      onError,
    });
    failedController.handleEvent({
      type: "session.started",
      session: { id: "session_2" },
    });
    failedController.handleEvent({
      type: "session.input_transcript.delta",
      delta: "open the graph",
    });
    failedController.handleEvent({
      type: "session.delegation.created",
      delegation: { id: "failed" },
    });
    await flushPromises();

    expect(onError).toHaveBeenCalledExactlyOnceWith("agent failure");
    expect(failureSend).toHaveBeenCalledOnce();
    expect(failureSend).toHaveBeenCalledWith(
      expect.objectContaining({
        delegation_id: "failed",
        content: "That didn't work: the workspace agent hit an error.",
      }),
    );
    emptyController.dispose();
    failedController.dispose();
  });

  it("runs multiple delegations sequentially and gives empty requests a recovery prompt", async () => {
    const send = vi.fn();
    let resolveFirst!: (text: string) => void;
    const runAgentTurn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("second result");
    const controller = createLiveController({ send, runAgentTurn });
    controller.handleEvent({
      type: "session.started",
      session: { id: "session_1" },
    });
    controller.handleEvent({
      type: "session.input_transcript.delta",
      delta: "first request",
    });
    controller.handleEvent({
      type: "session.delegation.created",
      delegation: { id: "first" },
    });
    controller.handleEvent({
      type: "session.input_transcript.delta",
      delta: "second request",
    });
    controller.handleEvent({
      type: "session.delegation.created",
      delegation: { id: "second" },
    });
    await flushPromises();
    expect(runAgentTurn).toHaveBeenCalledOnce();
    resolveFirst("first result");
    await flushPromises();
    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([event]) => event.delegation_id)).toEqual([
      "first",
      "second",
    ]);
    expect(send.mock.calls.map(([event]) => event.content)).toEqual([
      "first result",
      "second result",
    ]);
    controller.dispose();
  });

  it("caps delegated replies and stops sending after disposal", async () => {
    const send = vi.fn();
    const controller = createLiveController({
      send,
      runAgentTurn: vi.fn().mockResolvedValue("x".repeat(MAX_APPEND_CHARS + 1)),
    });
    controller.handleEvent({
      type: "session.started",
      session: { id: "session_1" },
    });
    controller.handleEvent({
      type: "session.input_transcript.delta",
      delta: "request",
    });
    controller.handleEvent({
      type: "session.delegation.created",
      delegation: { id: "item_1" },
    });
    await flushPromises();
    expect(send.mock.calls[0][0].content).toHaveLength(MAX_APPEND_CHARS);

    const lateSend = vi.fn();
    let resolveTurn!: (text: string) => void;
    const disposed = createLiveController({
      send: lateSend,
      runAgentTurn: () =>
        new Promise<string>((resolve) => {
          resolveTurn = resolve;
        }),
    });
    disposed.handleEvent({
      type: "session.started",
      session: { id: "session_2" },
    });
    disposed.handleEvent({
      type: "session.input_transcript.delta",
      delta: "request",
    });
    disposed.handleEvent({
      type: "session.delegation.created",
      delegation: { id: "item_2" },
    });
    await flushPromises();
    disposed.dispose();
    resolveTurn("late reply");
    await flushPromises();
    expect(lateSend).not.toHaveBeenCalled();
    controller.dispose();
  });
});

class FakeDataChannel {
  readyState = "open";
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = "closed";
    this.onclose?.();
  });
}

class FakePeerConnection {
  iceGatheringState: RTCIceGatheringState = "complete";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  onicegatheringstatechange: ((event: Event) => void) | null = null;
  channel = new FakeDataChannel();
  createDataChannel = vi.fn(() => this.channel as unknown as RTCDataChannel);
  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: "offer-sdp" }));
  addTrack = vi.fn();
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description as RTCSessionDescription;
  });
  setRemoteDescription = vi.fn(async () => {});
  close = vi.fn();
}

function fakeRtcDependencies(fetchMock: typeof fetch) {
  const peer = new FakePeerConnection();
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const mediaStream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const audio = {
    autoplay: false,
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
  } as unknown as HTMLAudioElement;
  return {
    peer,
    track,
    audio,
    deps: {
      fetch: fetchMock,
      getUserMedia: vi.fn(async () => mediaStream),
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      createAudio: () => audio,
    },
  };
}

describe("live WebRTC client", () => {
  it("negotiates WebRTC without sending session.start", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ transport: { sdp: "answer" } }),
    );
    const { peer, deps } = fakeRtcDependencies(fetchMock);
    const live = createLiveVoice({
      runAgentTurn: vi.fn().mockResolvedValue("done"),
      deps,
    });

    await live.start();

    expect(live.state).toBe("connecting");
    expect(peer.createDataChannel).toHaveBeenCalledWith("oai-events");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/live",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sdp: "offer-sdp" }),
      }),
    );
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "answer",
    });
    expect(peer.channel.send).not.toHaveBeenCalled();
    peer.channel.onmessage?.({
      data: JSON.stringify({
        type: "session.started",
        session: { id: "session_1" },
      }),
    } as MessageEvent);
    expect(live.state).toBe("listening");
    peer.channel.onmessage?.({
      data: JSON.stringify({ type: "session.closed" }),
    } as MessageEvent);
    expect(live.state).toBe("idle");
    await live.stop();
  });

  it("enters error state and reports endpoint failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: "live unavailable" }, 503),
    );
    const { peer, deps } = fakeRtcDependencies(fetchMock);
    const onError = vi.fn();
    const live = createLiveVoice({
      runAgentTurn: vi.fn().mockResolvedValue("done"),
      onError,
      deps,
    });

    await live.start();

    expect(live.state).toBe("error");
    expect(onError).toHaveBeenCalledExactlyOnceWith("live unavailable");
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it("waits for session.closed before cleaning up on an explicit stop", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ transport: { sdp: "answer" } }),
    );
    const { peer, deps } = fakeRtcDependencies(fetchMock);
    const live = createLiveVoice({
      runAgentTurn: vi.fn().mockResolvedValue("done"),
      deps,
    });
    await live.start();
    peer.channel.onmessage?.({
      data: JSON.stringify({
        type: "session.started",
        session: { id: "session_1" },
      }),
    } as MessageEvent);
    peer.channel.send.mockImplementation((serialized: string) => {
      expect(JSON.parse(serialized)).toMatchObject({ type: "session.close" });
      peer.channel.onmessage?.({
        data: JSON.stringify({ type: "session.closed", reason: "close_requested" }),
      } as MessageEvent);
    });

    await live.stop();

    expect(peer.channel.send).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(live.state).toBe("idle");
  });
});
