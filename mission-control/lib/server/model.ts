import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { Task } from "@/lib/types";
import { createDemoModel, type DemoScenario } from "./demo-model";

type Provider = "openai" | "anthropic";

function configuredModel(): string {
  const configured = process.env.MC_MODEL?.trim();
  if (configured) return configured;
  return process.env.OPENAI_API_KEY ? "openai:gpt-5-mini" : "demo";
}

function hasProviderKey(provider: Provider): boolean {
  return provider === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY);
}

export function isDemo(): boolean {
  const value = configuredModel();
  if (value === "demo") return true;
  const [provider] = value.split(":");
  return (provider !== "openai" && provider !== "anthropic") || !hasProviderKey(provider);
}

export function modelLabel(): string {
  return isDemo() ? "demo" : configuredModel();
}

export function getModel(scenario?: DemoScenario) {
  if (isDemo()) return createDemoModel(scenario ?? { kind: "shepherd", userText: "" });
  const [provider, ...modelParts] = configuredModel().split(":");
  const modelId = modelParts.join(":");
  if (!modelId) throw new Error("MC_MODEL must use provider:modelId format");
  if (provider === "openai") return openai(modelId);
  if (provider === "anthropic") return anthropic(modelId);
  throw new Error(`Unsupported MC_MODEL provider: ${provider}`);
}

export function voiceAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function armScenario(task: Task, answer?: string): DemoScenario {
  return { kind: "arm", task, answer };
}
