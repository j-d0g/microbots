import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getVoiceConfig } from "../../app/api/voice/config/route";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("voice config", () => {
  it("returns browser providers when no API key is set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await (await getVoiceConfig()).json()).toEqual({
      stt: "browser",
      tts: "browser",
    });
  });

  it("returns OpenAI providers when the API key is set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(await (await getVoiceConfig()).json()).toEqual({
      stt: "openai",
      tts: "openai",
    });
  });

  it("loads the server config and falls back to browser on errors", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ stt: "openai", tts: "openai" }),
    ));
    const voice = await import("@/lib/voice");
    await expect(voice.loadVoiceConfig()).resolves.toEqual({
      stt: "openai",
      tts: "openai",
    });

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    const rejectedVoice = await import("@/lib/voice");
    await expect(rejectedVoice.loadVoiceConfig()).resolves.toEqual({
      stt: "browser",
      tts: "browser",
    });

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 503 }),
    ));
    const unavailableVoice = await import("@/lib/voice");
    await expect(unavailableVoice.loadVoiceConfig()).resolves.toEqual({
      stt: "browser",
      tts: "browser",
    });
  });

  it("cancels browser TTS and ends once", async () => {
    vi.resetModules();
    class MockUtterance {
      rate = 1;
      pitch = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(public text: string) {}
    }
    const synthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    };
    vi.stubGlobal("window", { speechSynthesis: synthesis });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ stt: "browser", tts: "browser" }),
    ));

    const { cancelSpeak, speak } = await import("@/lib/voice");
    const onEnd = vi.fn();
    await speak("hello", { onEnd });

    expect(synthesis.speak).toHaveBeenCalledOnce();
    const utterance = synthesis.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.text).toBe("hello");

    cancelSpeak();
    utterance.onend?.();
    expect(synthesis.cancel).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("does not play TTS after cancellation while fetch is pending", async () => {
    vi.resetModules();
    let resolveTts!: (response: Response) => void;
    const pendingTts = new Promise<Response>((resolve) => {
      resolveTts = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ stt: "openai", tts: "openai" }))
      .mockReturnValueOnce(pendingTts);
    const synthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    };
    const audioMock = vi.fn();
    vi.stubGlobal("window", { speechSynthesis: synthesis });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    vi.stubGlobal("Audio", audioMock);
    vi.stubGlobal("fetch", fetchMock);

    const { cancelSpeak, speak } = await import("@/lib/voice");
    const onEnd = vi.fn();
    const speaking = speak("hello", { onEnd });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    cancelSpeak();
    expect(onEnd).toHaveBeenCalledOnce();
    resolveTts(new Response(new Uint8Array([1, 2, 3])));
    await speaking;

    expect(audioMock).not.toHaveBeenCalled();
    expect(synthesis.speak).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("falls back to browser TTS when the OpenAI TTS request fails", async () => {
    vi.resetModules();
    class MockUtterance {
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(public text: string) {}
    }
    const synthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ stt: "openai", tts: "openai" }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("window", { speechSynthesis: synthesis });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    vi.stubGlobal("fetch", fetchMock);

    const { speak } = await import("@/lib/voice");
    await speak("hello");

    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect((synthesis.speak.mock.calls[0][0] as MockUtterance).text).toBe("hello");
  });
});
