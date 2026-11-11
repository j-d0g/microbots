import type { Agent, Priority, Snapshot, Task, TaskStatus } from "@/lib/types";

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: Priority;
  agentId?: string;
}

export interface PatchTaskInput {
  status?: TaskStatus;
  priority?: Priority;
  agentId?: string | null;
  title?: string;
}

export interface CreateAgentInput {
  name: string;
  role: string;
  goal: string;
  voice?: string;
}

export function getState(): Promise<Snapshot> {
  return jsonRequest("/api/state");
}

export function command(text: string): Promise<{ reply: string }> {
  return jsonRequest("/api/command", { method: "POST", body: JSON.stringify({ text }) });
}

export function createTask(input: CreateTaskInput): Promise<Task> {
  return jsonRequest("/api/tasks", { method: "POST", body: JSON.stringify(input) });
}

export function patchTask(id: string, input: PatchTaskInput): Promise<Task> {
  return jsonRequest(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deleteTask(id: string): Promise<void> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
}

export function answerTask(id: string, answer: string): Promise<{ ok: true }> {
  return jsonRequest(`/api/tasks/${encodeURIComponent(id)}/answer`, { method: "POST", body: JSON.stringify({ answer }) });
}

export function createAgent(input: CreateAgentInput): Promise<Agent> {
  return jsonRequest("/api/agents", { method: "POST", body: JSON.stringify(input) });
}

export function reset(): Promise<Snapshot> {
  return jsonRequest("/api/reset", { method: "POST" });
}

export async function speak(input: { text: string; voice?: string; fast?: boolean }): Promise<Blob> {
  const response = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  }
  return response.blob();
}

export async function transcribe(audio: File): Promise<{ text: string }> {
  const form = new FormData();
  form.set("audio", audio);
  const response = await fetch("/api/voice/transcribe", { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  }
  return response.json() as Promise<{ text: string }>;
}
