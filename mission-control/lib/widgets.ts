import { z } from "zod";

// The only things the shepherd can draw on the stage. Typed + validated, so a bad
// tool call is a schema error the model can retry, never a broken screen.
const tone = z.enum(["neutral", "good", "warn", "bad"]).optional();

export const widgetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("brief"),
    title: z.string(),
    bullets: z.array(z.string()).min(1).max(6),
  }),
  z.object({
    kind: z.literal("stats"),
    title: z.string().optional(),
    items: z
      .array(z.object({ label: z.string(), value: z.string(), delta: z.string().optional(), tone }))
      .min(1)
      .max(6),
  }),
  z.object({
    kind: z.literal("list"),
    title: z.string(),
    items: z
      .array(z.object({ title: z.string(), subtitle: z.string().optional(), tone }))
      .min(1)
      .max(10),
  }),
  z.object({
    kind: z.literal("timeline"),
    title: z.string(),
    events: z
      .array(z.object({ time: z.string(), label: z.string(), agentId: z.string().optional() }))
      .min(1)
      .max(10),
  }),
  z.object({
    kind: z.literal("chart"),
    title: z.string(),
    type: z.enum(["bar", "line"]),
    unit: z.string().optional(),
    series: z.array(z.object({ label: z.string(), value: z.number() })).min(1).max(14),
  }),
  z.object({
    kind: z.literal("decision"),
    question: z.string(),
    options: z.array(z.object({ label: z.string(), hint: z.string().optional() })).min(2).max(4),
    taskId: z.string().optional(), // if set, a click answers that task's ask
  }),
  z.object({ kind: z.literal("agent"), agentId: z.string() }),
  z.object({ kind: z.literal("task"), taskId: z.string() }),
  z.object({ kind: z.literal("markdown"), title: z.string(), body: z.string() }),
]);

export type Widget = z.infer<typeof widgetSchema>;
export type WidgetKind = Widget["kind"];
