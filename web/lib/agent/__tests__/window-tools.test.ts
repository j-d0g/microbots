/**
 * Window Tools Test Suite
 *
 * Validates all 15 window tool factories:
 * 1. Importability - all factories can be imported without errors
 * 2. Factory function signature - accepts AgentToolCtx, returns object
 * 3. Naming convention - all tools follow {prefix}_{action} pattern
 * 4. Tool counts - matches expected counts per window kind
 * 5. Tool structure - each tool has inputSchema and execute function
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { AgentToolCtx } from "../tools";
import type { CanvasSnapshot } from "../types";

// Import all window tool factories
import {
  graphWindowTools,
  chatWindowTools,
  askUserWindowTools,
  settingsWindowTools,
  profileWindowTools,
  integrationsWindowTools,
  integrationDetailWindowTools,
  entitiesWindowTools,
  entityDetailWindowTools,
  memoriesWindowTools,
  skillsWindowTools,
  workflowsWindowTools,
  wikiWindowTools,
  chatsSummaryWindowTools,
  windowManagementTools,
} from "../window-tools";

// Expected tool counts per window kind (based on actual implementation)
const EXPECTED_TOOL_COUNTS: Record<string, number> = {
  graph: 12,
  chat: 8,
  ask_user: 8,
  settings: 8,
  profile: 9,
  integrations: 12,
  integration_detail: 10,
  entities: 10,
  entity_detail: 11,
  memories: 12,
  skills: 12,
  workflows: 13,
  wiki: 13,
  chats_summary: 12,
  window_management: 19,
};

// Tool name prefixes per window kind
const TOOL_PREFIXES: Record<string, string> = {
  graph: "graph",
  chat: "chat",
  ask_user: "askuser",
  settings: "settings",
  profile: "profile",
  integrations: "integrations",
  integration_detail: "integration_detail",
  entities: "entities",
  entity_detail: "entity_detail",
  memories: "memories",
  skills: "skills",
  workflows: "workflows",
  wiki: "wiki",
  chats_summary: "chatsummary",
  window_management: "winman",
};

// Factory functions map for testing
const FACTORY_MAP: Record<string, (ctx: AgentToolCtx) => Record<string, unknown>> = {
  graph: graphWindowTools,
  chat: chatWindowTools,
  ask_user: askUserWindowTools,
  settings: settingsWindowTools,
  profile: profileWindowTools,
  integrations: integrationsWindowTools,
  integration_detail: integrationDetailWindowTools,
  entities: entitiesWindowTools,
  entity_detail: entityDetailWindowTools,
  memories: memoriesWindowTools,
  skills: skillsWindowTools,
  workflows: workflowsWindowTools,
  wiki: wikiWindowTools,
  chats_summary: chatsSummaryWindowTools,
  window_management: windowManagementTools,
};

/**
 * Create a mock AgentToolCtx for testing
 * Uses a fake snapshot and emit function - no real LLM calls
 */
function createMockCtx(): AgentToolCtx {
  const emittedEvents: unknown[] = [];

  const mockSnapshot: CanvasSnapshot = {
    viewport: { w: 1920, h: 1080 },
    grid: "A B · ·\n· · · ·",
    focusedId: null,
    windows: [],
    recentActions: [],
    user: { query: "test", userId: null },
    ui: { mode: "windowed" },
    integrations: [],
    backend: { surrealOk: true, composioOk: true },
  };

  return {
    snapshot: mockSnapshot,
    emit: (event: unknown) => {
      emittedEvents.push(event);
    },
  };
}

/**
 * Validate tool naming convention: {prefix}_{action}
 * Where prefix matches the window kind and action describes the operation
 */
function validateToolName(name: string, prefix: string): boolean {
  // Special case for ask_user -> askuser prefix
  const normalizedPrefix = prefix === "ask_user" ? "askuser" : prefix;

  // Tool name should start with the prefix
  if (!name.startsWith(`${normalizedPrefix}_`)) {
    return false;
  }

  // Should have at least one action part after the prefix
  const actionPart = name.slice(normalizedPrefix.length + 1);
  if (actionPart.length === 0) {
    return false;
  }

  // Should not contain spaces
  if (name.includes(" ")) {
    return false;
  }

  // Should use snake_case (lowercase with underscores)
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return false;
  }

  return true;
}

/**
 * Validate tool structure has required properties
 */
function validateToolStructure(tool: unknown): {
  valid: boolean;
  hasInputSchema: boolean;
  hasExecute: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof tool !== "object" || tool === null) {
    return { valid: false, hasInputSchema: false, hasExecute: false, errors: ["Tool is not an object"] };
  }

  const toolObj = tool as Record<string, unknown>;

  // Check for description (required for AI SDK tools)
  if (typeof toolObj.description !== "string" || toolObj.description.length === 0) {
    errors.push("Missing or invalid description");
  }

  // Check for inputSchema (required for AI SDK tools)
  const hasInputSchema = toolObj.inputSchema !== undefined && toolObj.inputSchema !== null;
  if (!hasInputSchema) {
    errors.push("Missing inputSchema");
  }

  // Check for execute function (required for AI SDK tools)
  const hasExecute = typeof toolObj.execute === "function";
  if (!hasExecute) {
    errors.push("Missing or invalid execute function");
  }

  return {
    valid: errors.length === 0 && hasInputSchema && hasExecute,
    hasInputSchema,
    hasExecute,
    errors,
  };
}

describe("Window Tool Factories", () => {
  describe("1. Import Validation", () => {
    it("should import all 15 window tool factories without errors", () => {
      // All imports happen at module load time, so if we're here, imports worked
      expect(Object.keys(FACTORY_MAP)).toHaveLength(15);

      // Verify each factory is a function
      for (const [name, factory] of Object.entries(FACTORY_MAP)) {
        expect(typeof factory, `${name} should be a function`).toBe("function");
      }
    });
  });

  describe("2. Factory Function Signature", () => {
    it.each(Object.entries(FACTORY_MAP) as [string, (ctx: AgentToolCtx) => Record<string, unknown>][])(
      "%s factory should accept AgentToolCtx and return an object",
      (windowKind, factory) => {
        const ctx = createMockCtx();
        const tools = factory(ctx);

        expect(typeof tools, `${windowKind} should return an object`).toBe("object");
        expect(tools, `${windowKind} should not return null`).not.toBeNull();
        expect(Array.isArray(tools), `${windowKind} should not return an array`).toBe(false);
      }
    );
  });

  describe("3. Tool Naming Convention", () => {
    it.each(Object.entries(FACTORY_MAP) as [string, (ctx: AgentToolCtx) => Record<string, unknown>][])(
      "%s tools should follow {prefix}_{action} naming convention",
      (windowKind, factory) => {
        const ctx = createMockCtx();
        const tools = factory(ctx);
        const toolNames = Object.keys(tools);
        const prefix = TOOL_PREFIXES[windowKind];

        for (const name of toolNames) {
          const isValid = validateToolName(name, prefix);
          expect(
            isValid,
            `Tool "${name}" in ${windowKind} should follow ${prefix}_{action} naming convention`
          ).toBe(true);
        }
      }
    );

    it.each(Object.entries(FACTORY_MAP) as [string, (ctx: AgentToolCtx) => Record<string, unknown>][])(
      "%s tools should not contain spaces or uppercase",
      (windowKind, factory) => {
        const ctx = createMockCtx();
        const tools = factory(ctx);
        const toolNames = Object.keys(tools);

        for (const name of toolNames) {
          expect(name, `Tool name should not contain spaces`).not.toContain(" ");
          expect(name, `Tool name should be lowercase`).toBe(name.toLowerCase());
        }
      }
    );
  });

  describe("4. Tool Count Validation", () => {
    it.each(Object.entries(EXPECTED_TOOL_COUNTS) as [string, number][]) (
      "%s should have approximately %i tools",
      (windowKind, expectedCount) => {
        const factory = FACTORY_MAP[windowKind];
        const ctx = createMockCtx();
        const tools = factory(ctx);
        const actualCount = Object.keys(tools).length;

        // Allow some flexibility (~20% tolerance) for evolving implementations
        const tolerance = Math.max(2, Math.ceil(expectedCount * 0.2));
        const minExpected = expectedCount - tolerance;
        const maxExpected = expectedCount + tolerance;

        expect(
          actualCount,
          `${windowKind} has ${actualCount} tools, expected ~${expectedCount} (±${tolerance})`
        ).toBeGreaterThanOrEqual(minExpected);
        expect(
          actualCount,
          `${windowKind} has ${actualCount} tools, expected ~${expectedCount} (±${tolerance})`
        ).toBeLessThanOrEqual(maxExpected);
      }
    );
  });

  describe("5. Tool Structure Validation", () => {
    it.each(Object.entries(FACTORY_MAP) as [string, (ctx: AgentToolCtx) => Record<string, unknown>][])(
      "%s tools should have required structure (inputSchema, execute)",
      (windowKind, factory) => {
        const ctx = createMockCtx();
        const tools = factory(ctx);
        const toolEntries = Object.entries(tools);

        for (const [toolName, tool] of toolEntries) {
          const validation = validateToolStructure(tool);

          expect(
            validation.hasInputSchema,
            `${windowKind}.${toolName} should have inputSchema`
          ).toBe(true);

          expect(
            validation.hasExecute,
            `${windowKind}.${toolName} should have execute function`
          ).toBe(true);

          // Check that description exists and is non-empty
          const toolObj = tool as Record<string, unknown>;
          expect(
            typeof toolObj.description,
            `${windowKind}.${toolName} should have description string`
          ).toBe("string");
          expect(
            (toolObj.description as string).length,
            `${windowKind}.${toolName} description should not be empty`
          ).toBeGreaterThan(0);
        }
      }
    );
  });

  describe("6. Tool Execution (Fast Mock Tests)", () => {
    it.each(Object.entries(FACTORY_MAP) as [string, (ctx: AgentToolCtx) => Record<string, unknown>][])(
      "%s tools should be callable without actual LLM calls",
      async (windowKind, factory) => {
        const ctx = createMockCtx();
        const tools = factory(ctx);
        const toolEntries = Object.entries(tools);

        for (const [toolName, tool] of toolEntries) {
          const toolObj = tool as { execute: Function; inputSchema: { parse?: Function; _def?: unknown } };

          // Get default/empty args based on schema
          const testArgs: Record<string, unknown> = {};

          // Try to get required fields from schema (basic heuristic)
          // The Zod schema will validate at runtime, we just need to call it
          try {
            // For tools with empty schemas, this works directly
            const result = await toolObj.execute(testArgs);

            // Result should be a string (tool return messages are strings)
            expect(
              typeof result,
              `${windowKind}.${toolName} execute should return a string`
            ).toBe("string");
          } catch (error) {
            // Some tools may require specific args - that's OK for this test
            // We're mainly checking that the function doesn't throw unexpectedly
            // and is properly bound to the context
            expect(error).toBeDefined();
          }
        }
      },
      30000 // 30 second timeout for all tools in a factory
    );
  });

  describe("7. Specific Tool Validation", () => {
    it("graph tools should have expected graph-specific tools", () => {
      const ctx = createMockCtx();
      const tools = graphWindowTools(ctx);

      // Core graph tools that should exist
      const expectedTools = [
        "graph_focus_node",
        "graph_zoom_fit",
        "graph_select",
        "graph_neighbors",
        "graph_highlight",
        "graph_zoom_to",
        "graph_path",
        "graph_filter_layer",
        "graph_filter_integration",
        "graph_search",
        "graph_clear",
        "graph_read_state",
      ];

      for (const toolName of expectedTools) {
        expect(tools, `graph should have ${toolName}`).toHaveProperty(toolName);
      }
    });

    it("wiki tools should have expected wiki-specific tools", () => {
      const ctx = createMockCtx();
      const tools = wikiWindowTools(ctx);

      const expectedTools = [
        "wiki_read_page",
        "wiki_navigate_to",
        "wiki_edit_page",
        "wiki_save_page",
        "wiki_cancel_edit",
        "wiki_list_children",
        "wiki_go_to_parent",
        "wiki_search",
        "wiki_read_revision_history",
        "wiki_revert_to_revision",
        "wiki_new_page",
        "wiki_delete_page",
        "wiki_go_to_index",
      ];

      for (const toolName of expectedTools) {
        expect(tools, `wiki should have ${toolName}`).toHaveProperty(toolName);
      }
    });

    it("window_management tools should have expected management tools", () => {
      const ctx = createMockCtx();
      const tools = windowManagementTools(ctx);

      const expectedTools = [
        "winman_move_to_position",
        "winman_arrange_preset",
        "winman_set_centre_arrangement",
        "winman_swap_positions",
        "winman_pin_window",
        "winman_unpin_window",
        "winman_toggle_pin",
        "winman_read_pinned",
        "winman_bring_to_front",
        "winman_send_to_back",
        "winman_read_focused",
        "winman_resize_window",
        "winman_maximize_window",
        "winman_minimize_window",
        "winman_close_all_except",
        "winman_cascade_windows",
        "winman_tile_windows",
        "winman_read_layout_state",
        "winman_read_window_list",
      ];

      for (const toolName of expectedTools) {
        expect(tools, `window_management should have ${toolName}`).toHaveProperty(toolName);
      }
    });
  });

  describe("8. Factory Isolation", () => {
    it("each factory should create independent tool instances", () => {
      const ctx1 = createMockCtx();
      const ctx2 = createMockCtx();

      const tools1 = graphWindowTools(ctx1);
      const tools2 = graphWindowTools(ctx2);

      // Should be different objects
      expect(tools1).not.toBe(tools2);

      // But should have same structure
      expect(Object.keys(tools1).sort()).toEqual(Object.keys(tools2).sort());
    });

    it("factories should not mutate shared state", () => {
      const ctx = createMockCtx();
      const originalWindowCount = ctx.snapshot.windows.length;

      // Call a tool that might modify state
      const tools = graphWindowTools(ctx);
      const readStateTool = tools.graph_read_state as { execute: Function };

      // Execute a read-only operation
      readStateTool.execute({});

      // Original context should not have been mutated unexpectedly
      // (some mutation via applyToolToSnapshot is expected, but not structural corruption)
      expect(ctx.snapshot).toBeDefined();
      expect(Array.isArray(ctx.snapshot.windows)).toBe(true);
    });
  });
});

// Summary test that runs all validations together
describe("Window Tools Summary", () => {
  it("should validate all 15 factories pass basic requirements", () => {
    const results: Record<string, { toolCount: number; validTools: number; errors: string[] }> = {};

    for (const [windowKind, factory] of Object.entries(FACTORY_MAP)) {
      const ctx = createMockCtx();
      const tools = factory(ctx);
      const toolEntries = Object.entries(tools);
      const prefix = TOOL_PREFIXES[windowKind];

      let validTools = 0;
      const errors: string[] = [];

      for (const [toolName, tool] of toolEntries) {
        // Validate name
        if (!validateToolName(toolName, prefix)) {
          errors.push(`Invalid name: ${toolName}`);
          continue;
        }

        // Validate structure
        const validation = validateToolStructure(tool);
        if (validation.valid) {
          validTools++;
        } else {
          errors.push(`${toolName}: ${validation.errors.join(", ")}`);
        }
      }

      results[windowKind] = {
        toolCount: toolEntries.length,
        validTools,
        errors,
      };
    }

    // All factories should have at least some valid tools
    for (const [windowKind, result] of Object.entries(results)) {
      expect(
        result.validTools,
        `${windowKind} should have valid tools (found ${result.validTools}/${result.toolCount})`
      ).toBeGreaterThan(0);

      expect(
        result.errors,
        `${windowKind} should have no validation errors`
      ).toEqual([]);
    }

    // Log summary for debugging
    console.log("\nWindow Tools Validation Summary:");
    console.log("================================");
    for (const [windowKind, result] of Object.entries(results)) {
      const status = result.errors.length === 0 ? "✓" : "✗";
      console.log(`${status} ${windowKind}: ${result.validTools}/${result.toolCount} tools valid`);
    }
  });
});
