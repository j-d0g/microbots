import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool } from "ai";
import { z } from "zod";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a coding agent. The user gives you a task; you decide what to do.

You have four tools:

- run_code(code) — execute Python in a fresh subprocess (30s timeout). Returns stdout, stderr, exit_code. Print values you want to see.
- find_examples(query) — search a small library of code templates by keyword. Use this BEFORE writing code if you suspect a relevant template exists. Returns up to 3 templates with full source.
- save_workflow(name, code) — persist a Python snippet as a named, reusable workflow. Returns a stable URL. Use this when the user wants to save / promote / publish work.
- ask_user(question, options?) — pause and ask the user a confirmation question. Use this BEFORE destructive actions (sending messages, writing files, calling APIs that cost money). Returns the user's answer as a string.

Style: keep responses short. Show your work briefly, then give the answer. Prefer find_examples over guessing if you suspect a template exists.`;

type Template = { id: string; title: string; description: string; tags: string[]; code: string };

async function loadTemplates(): Promise<Template[]> {
  const p = path.join(process.cwd(), "templates", "index.json");
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

function runPython(code: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; exit_code: number; timed_out: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-c", code], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exit_code: code ?? -1, timed_out: timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), exit_code: -1, timed_out: timedOut });
    });
  });
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    // Sonnet 4.6 default — fast, tool-use solid, temperature accepted.
    // Override via ANTHROPIC_MODEL env if you want Opus (set temperature:1 then).
    model: anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"),
    system: SYSTEM_PROMPT,
    messages,
    maxSteps: 8,
    tools: {
      run_code: tool({
        description:
          "Execute Python code in a fresh subprocess. 30s timeout. Returns stdout, stderr, and exit_code. Print values you want to see.",
        parameters: z.object({
          code: z.string().describe("Python source to execute via `python3 -c`."),
        }),
        execute: async ({ code }) => {
          return await runPython(code);
        },
      }),

      find_examples: tool({
        description:
          "Search the local template library by keyword. Returns up to 3 matching templates with id, title, description, and full source code. Use BEFORE writing code if a template might match.",
        parameters: z.object({
          query: z.string().describe("Keyword(s) to match against template title, description, and tags."),
        }),
        execute: async ({ query }) => {
          const templates = await loadTemplates();
          const q = query.toLowerCase();
          const scored = templates
            .map((t) => {
              const haystack = (t.title + " " + t.description + " " + t.tags.join(" ")).toLowerCase();
              const score = q.split(/\s+/).filter(Boolean).reduce((s, w) => s + (haystack.includes(w) ? 1 : 0), 0);
              return { t, score };
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map((x) => x.t);
          return { matches: scored, count: scored.length };
        },
      }),

      save_workflow: tool({
        description:
          "Persist a Python snippet as a named workflow. Writes to disk and returns a stable URL. Use this when the user wants to save / promote / ship the code.",
        parameters: z.object({
          name: z.string().describe("Slug for the workflow (lowercase, hyphenated, no spaces)."),
          code: z.string().describe("Python source code to save."),
        }),
        execute: async ({ name, code }) => {
          const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
          if (!slug) return { error: "invalid name" };
          const dir = path.join(process.cwd(), "saved");
          await fs.mkdir(dir, { recursive: true });
          const filePath = path.join(dir, `${slug}.py`);
          await fs.writeFile(filePath, code, "utf-8");
          return {
            url: `https://example.com/workflows/${slug}`,
            saved_to: filePath,
            bytes: Buffer.byteLength(code, "utf-8"),
          };
        },
      }),

      ask_user: tool({
        description:
          "Pause and ask the user a confirmation question. Use BEFORE destructive actions (sending messages, writing files, calling paid APIs). The user's answer is returned as a string.",
        parameters: z.object({
          question: z.string().describe("The question to surface to the user."),
          options: z.array(z.string()).optional().describe("Optional preset answer choices (max 5)."),
        }),
        // Client-resolved: frontend renders the prompt UI and sends the answer back as the tool result.
        // No execute() — leaving it undefined makes the AI SDK treat this as a client-side tool.
      }),
    },
    onError: ({ error }) => {
      console.error("[/api/chat] streamText error:", error);
    },
  });

  return result.toDataStreamResponse({
    getErrorMessage: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[/api/chat] stream error:", msg);
      return msg;
    },
  });
}
