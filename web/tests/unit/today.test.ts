import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setCandidateStatus,
  todaySectionsForFocus,
} from "@/components/windows/TodayWindow";
import type { AutomationCandidate, TodayResponse } from "@/lib/api/backend";

const candidate: AutomationCandidate = {
  id: "automation_candidate:pr_review_summaries",
  title: "Draft PR review summaries for Bob",
  story: "Reviews recur.",
  suggested_action: "Draft a review summary.",
  signal_axes: { kind: "automation", risk_tier: 2 },
  status: "open",
  evidence: [{ type: "chat", id: "chat:github_pr_schema", text: "PR review" }],
};

const today: TodayResponse = {
  needs_you: [],
  suggestions: [candidate],
  recent: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Today candidate decisions", () => {
  it("posts Accept and collapses the optimistic row to accepted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ...candidate,
      status: "accepted",
      updated_at: "2026-01-01T00:00:00Z",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const changes: TodayResponse[] = [];

    const updated = await setCandidateStatus(
      today,
      candidate.id,
      "accepted",
      "default",
      (value) => changes.push(value),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/kg/candidates/automation_candidate%3Apr_review_summaries",
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)))
      .toEqual({ status: "accepted" });
    expect(changes[0].suggestions[0].status).toBe("accepted");
    expect(updated.suggestions[0].status).toBe("accepted");
  });

  it("rolls the row back when the status request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ detail: "temporary failure" }, { status: 500 }),
    ));
    const changes: TodayResponse[] = [];

    const updated = await setCandidateStatus(
      today,
      candidate.id,
      "dismissed",
      "default",
      (value) => changes.push(value),
    );

    expect(changes.map((value) => value.suggestions[0].status))
      .toEqual(["dismissed", "open"]);
    expect(updated).toBe(today);
  });
});

describe("Today focus sections", () => {
  it("shows only the requested section for needs-you and suggestions focus", () => {
    const focusedToday: TodayResponse = {
      needs_you: [{
        ...candidate,
        id: "automation_candidate:release_question",
        title: "Review the release note",
        signal_axes: { kind: "question", risk_tier: 2 },
      }],
      suggestions: [candidate],
      recent: [{ id: "chat:recent", title: "Recent chat", source_type: "slack_thread" }],
    };

    expect(todaySectionsForFocus(focusedToday, "needs_you")).toEqual({
      needs_you: focusedToday.needs_you,
      suggestions: [],
      recent: [],
    });
    expect(todaySectionsForFocus(focusedToday, "suggestions")).toEqual({
      needs_you: [],
      suggestions: focusedToday.suggestions,
      recent: [],
    });
  });
});
