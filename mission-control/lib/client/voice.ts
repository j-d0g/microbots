"use client";
// Voice I/O. Server OpenAI TTS/STT when a key is set, browser speech APIs otherwise.
import type { SpeakRequest } from "@/lib/types";
import { audioLevel, useUI } from "./ui-store";
import { useMissionStore } from "./store";

interface Line { text: string; voice: string; fast: boolean; agentId: string }

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let current: HTMLAudioElement | null = null;
let queue: Line[] = [];
let playing = false;
let fakeLevel = false;

const ui = () => useUI.getState();
const snap = () => useMissionStore.getState().snapshot;

function audio(): { ctx: AudioContext; analyser: AnalyserNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(ctx.destination);
      levelLoop();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, analyser: analyser! };
}

function levelLoop() {
  const buf = new Uint8Array(128);
  const tick = () => {
    let v = 0;
    if (fakeLevel) v = 0.35 + 0.25 * Math.sin(performance.now() / 90) * Math.sin(performance.now() / 230);
    else if (analyser) {
      analyser.getByteFrequencyData(buf);
      v = buf.reduce((a, b) => a + b, 0) / (buf.length * 255);
      v = Math.min(1, v * 2.2);
    }
    audioLevel.current += (v - audioLevel.current) * 0.25;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function voiceFor(agentId: string): string {
  return snap()?.agents.find((a) => a.id === agentId)?.voice ?? "verse";
}

export function say(text: string, agentId = "shepherd", fast = false) {
  if (!text.trim()) return;
  queue.push({ text, voice: voiceFor(agentId), fast, agentId });
  void pump();
}

async function pump() {
  if (playing) return;
  playing = true;
  while (queue.length) {
    const line = queue.shift()!;
    ui().set({ voiceState: "speaking", speakingAgentId: line.agentId });
    const ok = snap()?.voice.tts ? await playServer(line) : false;
    if (!ok) await playBrowser(line);
  }
  playing = false;
  if (ui().voiceState === "speaking") ui().set({ voiceState: "idle", speakingAgentId: null });
}

async function playServer(line: Line): Promise<boolean> {
  try {
    const r = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: line.text, voice: line.voice, fast: line.fast }),
    });
    if (!r.ok) return false;
    const url = URL.createObjectURL(await r.blob());
    const el = new Audio(url);
    current = el;
    const a = audio();
    if (a) a.ctx.createMediaElementSource(el).connect(a.analyser);
    await new Promise<void>((res) => {
      el.onended = el.onerror = el.onpause = () => res();
      el.play().catch(() => res());
    });
    URL.revokeObjectURL(url);
    current = null;
    return true;
  } catch {
    return false;
  }
}

function playBrowser(line: Line): Promise<void> {
  if (typeof speechSynthesis === "undefined") return new Promise((r) => setTimeout(r, Math.min(4000, line.text.length * 45)));
  return new Promise((res) => {
    const u = new SpeechSynthesisUtterance(line.text);
    u.rate = line.fast ? 1.25 : 1.05;
    // Give each agent a distinct browser voice when several exist.
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    if (voices.length) u.voice = voices[Math.abs(hash(line.voice)) % voices.length];
    fakeLevel = true;
    u.onend = u.onerror = () => {
      fakeLevel = false;
      res();
    };
    speechSynthesis.speak(u);
    setTimeout(() => { fakeLevel = false; res(); }, 20000);
  });
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

/** Barge-in: stop everything now. */
export function hush() {
  queue = [];
  current?.pause();
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  fakeLevel = false;
  if (ui().voiceState === "speaking") ui().set({ voiceState: "idle", speakingAgentId: null });
}

/** Decide how a speak request is voiced under the current attention mode. */
export function handleSpeak(req: SpeakRequest) {
  const { attention, held, set } = ui();
  if (attention === "mute") return;
  const isReply = req.agentId === "shepherd" && req.level === "info";
  if (attention === "focus" && !isReply) {
    say(req.gist, req.agentId, true);
    set({ held: [...held, req] });
    return;
  }
  say(req.text, req.agentId, req.fast);
}

export function briefHeld() {
  const { held, set } = ui();
  set({ held: [] });
  for (const h of held) say(h.text, h.agentId, h.fast);
}

// ---- listening ----
type Rec = { stop: () => Promise<string> };
let rec: Rec | null = null;

export async function startListening() {
  if (rec) return;
  hush();
  ui().set({ voiceState: "listening", interim: "" });
  try {
    rec = snap()?.voice.stt ? await serverRecorder() : browserRecognizer();
  } catch {
    rec = null;
    ui().set({ voiceState: "idle" });
  }
}

export async function stopListening(): Promise<string> {
  const r = rec;
  rec = null;
  if (!r) return "";
  ui().set({ voiceState: "transcribing" });
  const text = (await r.stop().catch(() => "")).trim();
  ui().set({ voiceState: "idle", interim: "" });
  return text;
}

async function serverRecorder(): Promise<Rec> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const a = audio();
  if (a) a.ctx.createMediaStreamSource(stream).connect(a.analyser); // drives the orb, not the speakers
  if (a) a.analyser.disconnect();
  const mr = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => chunks.push(e.data);
  mr.start();
  return {
    stop: () =>
      new Promise((res) => {
        mr.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          if (a) a.analyser.connect(a.ctx.destination);
          const fd = new FormData();
          fd.append("audio", new Blob(chunks, { type: mr.mimeType || "audio/webm" }), "speech.webm");
          try {
            const r = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
            res(r.ok ? ((await r.json()) as { text: string }).text : "");
          } catch {
            res("");
          }
        };
        mr.stop();
      }),
  };
}

type SR = { start(): void; stop(): void; interimResults: boolean; continuous: boolean; lang: string; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

function browserRecognizer(): Rec {
  const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!Ctor) throw new Error("no speech recognition");
  const r = new Ctor();
  r.interimResults = true;
  r.continuous = true;
  r.lang = "en-US";
  let text = "";
  fakeLevel = true;
  r.onresult = (e) => {
    text = Array.from(e.results).map((x) => x[0].transcript).join(" ");
    ui().set({ interim: text });
  };
  r.start();
  return {
    stop: () =>
      new Promise((res) => {
        r.onend = r.onerror = () => { fakeLevel = false; res(text); };
        r.stop();
        setTimeout(() => { fakeLevel = false; res(text); }, 1500);
      }),
  };
}
