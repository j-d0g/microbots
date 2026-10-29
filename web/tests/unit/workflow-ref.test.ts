import { describe, expect, it } from "vitest";
import { resolveWorkflowRef } from "@/components/windows/WorkflowsWindow";

describe("resolveWorkflowRef", () => {
  const workflows = [
    { slug: "bug_triage", name: "Deploy Pipeline" },
    { slug: "deploy_pipeline", name: "Bug Triage" },
  ];

  it("matches an exact slug before a workflow name", () => {
    expect(resolveWorkflowRef(workflows, "bug_triage")).toBe("bug_triage");
  });

  it("matches a workflow name case-insensitively", () => {
    expect(resolveWorkflowRef(workflows, "bUg TrIaGe")).toBe("deploy_pipeline");
  });

  it("returns null when the reference is not found", () => {
    expect(resolveWorkflowRef(workflows, "unknown")).toBeNull();
  });
});
