import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postStt } from "../../app/api/stt/route";
import { POST as postTts } from "../../app/api/tts/route";

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

describe("voice routes", () => {
  it("returns a browser fallback when STT has no API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postStt(
      new Request("http://localhost/api/stt", { method: "POST" }) as never,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "OPENAI_API_KEY not set; using browser voice.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends multipart audio to OpenAI and returns the transcript", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ text: " hello " }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const form = new FormData();
    form.append("audio", new Blob(["audio"], { type: "audio/webm" }), "speech.webm");
    const response = await postStt(
      new Request("http://localhost/api/stt", {
        method: "POST",
        body: form,
      }) as never,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-test");
    const sentForm = init?.body as FormData;
    expect(sentForm.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(sentForm.get("file")).toBeInstanceOf(Blob);
    expect(await response.json()).toEqual({ text: "hello" });
  });

  it("rejects an STT request without audio", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    const response = await postStt(
      new Request("http://localhost/api/stt", {
        method: "POST",
        body: new FormData(),
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "audio field required" });
  });

  it("maps an upstream STT error to 502", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream failed", { status: 500 }),
    ));
    const form = new FormData();
    form.append("audio", new Blob(["audio"]), "speech.webm");

    const response = await postStt(
      new Request("http://localhost/api/stt", {
        method: "POST",
        body: form,
      }) as never,
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "openai stt 500: upstream failed",
    });
  });

  it("returns a browser fallback when TTS has no API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postTts(
      new Request("http://localhost/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "hi there" }),
      }) as never,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "OPENAI_API_KEY not set; using browser voice.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards TTS input and streams OpenAI audio", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_TTS_VOICE", "");
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "audio/mpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postTts(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi there", voice: "ignored" }),
      }) as never,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-4o-mini-tts",
      input: "hi there",
      voice: "alloy",
      response_format: "mp3",
    });
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("uses the configured TTS voice", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_TTS_VOICE", "nova");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1])),
    );
    vi.stubGlobal("fetch", fetchMock);

    await postTts(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi there" }),
      }) as never,
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      voice: "nova",
    });
  });

  it("rejects blank TTS text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postTts(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "  " }),
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "text required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
