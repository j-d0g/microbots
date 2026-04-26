/**
 * Smoke tests for the KG write functions in lib/api/backend.ts.
 * Mocks global fetch and verifies each function sends the correct
 * HTTP method, URL path, and request body.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  upsertSkill,
  upsertWorkflow,
  addChat,
  writeWikiPage,
  updateUser,
  // Also import existing writes to confirm they still resolve
  addMemory,
  upsertEntity,
} from "../../lib/api/backend";

/* ---------- helpers ---------- */

/** Builds a mock Response that resolves to the given JSON. */
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

/* ---------- tests ---------- */

describe("KG write functions", () => {
  it("upsertSkill sends POST /api/kg/skills with correct body", async () => {
    const responseBody = { id: "skill:1", slug: "test-skill" };
    fetchSpy.mockResolvedValueOnce(jsonResponse(responseBody, 201));

    const body = {
      slug: "test-skill",
      name: "Test Skill",
      description: "A test skill",
      steps: ["step1"],
      strength_increment: 2,
      tags: ["demo"],
    };
    const result = await upsertSkill(body, "user-1");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/kg/skills");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.headers["X-User-Id"]).toBe("user-1");
    expect(result).toEqual(responseBody);
  });

  it("upsertWorkflow sends POST /api/kg/workflows with correct body", async () => {
    const responseBody = { id: "wf:1", slug: "test-wf" };
    fetchSpy.mockResolvedValueOnce(jsonResponse(responseBody, 201));

    const body = {
      slug: "test-wf",
      name: "Test Workflow",
      description: "A test workflow",
      trigger: "on-demand",
      skill_chain: [{ slug: "test-skill", step_order: 1 }],
    };
    const result = await upsertWorkflow(body, "user-1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/kg/workflows");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
    expect(result).toEqual(responseBody);
  });

  it("addChat sends POST /api/kg/chats with correct body", async () => {
    const responseBody = { id: "rec:1", chat_id: "chat:1" };
    fetchSpy.mockResolvedValueOnce(jsonResponse(responseBody, 201));

    const body = {
      content: "Hello world",
      source_type: "slack",
      signal_level: "high" as const,
      mentions: [{ id: "ent:1", mention_type: "person" }],
    };
    const result = await addChat(body, "user-1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/kg/chats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
    expect(result).toEqual(responseBody);
  });

  it("writeWikiPage sends PUT /api/kg/wiki/{path} with correct body", async () => {
    const responseBody = { path: "onboarding/setup", revision: 3 };
    fetchSpy.mockResolvedValueOnce(jsonResponse(responseBody));

    const wikiBody = { content: "# Setup\nDo the thing.", rationale: "initial" };
    const result = await writeWikiPage("onboarding/setup", wikiBody, "user-1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/kg/wiki/onboarding%2Fsetup");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(wikiBody);
    expect(result).toEqual(responseBody);
  });

  it("updateUser sends PATCH /api/kg/user with correct body", async () => {
    const responseBody = {
      id: "user:1",
      name: "Jordan",
      role: "dev",
      goals: ["ship"],
      preferences: {},
      context_window: 4096,
      created_at: "",
      updated_at: "",
      chat_count: 0,
      memory_count: 0,
      entity_count: 0,
      skill_count: 0,
      workflow_count: 0,
      integration_count: 0,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(responseBody));

    const body = { name: "Jordan", goals: ["ship"], context_window: 4096 };
    const result = await updateUser(body, "user-1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/kg/user");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual(body);
    expect(result).toEqual(responseBody);
  });

  it("existing addMemory still works", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "rec:1", memory_id: "mem:1" }, 201),
    );
    const result = await addMemory({ content: "test" }, "user-1");
    expect(result).toEqual({ id: "rec:1", memory_id: "mem:1" });
  });

  it("existing upsertEntity still works", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "ent:1", slug: "test-entity" }, 201),
    );
    const result = await upsertEntity(
      { name: "Test", entity_type: "person" },
      "user-1",
    );
    expect(result).toEqual({ id: "ent:1", slug: "test-entity" });
  });
});
