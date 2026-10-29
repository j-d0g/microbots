import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchKgResource } from "../../lib/use-kg-resource";

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchKgResource", () => {
  it("deduplicates in-flight requests by URL", async () => {
    let resolveRequest!: (value: string[]) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const first = fetchKgResource("/api/kg/test-in-flight", fetcher);
    const second = fetchKgResource("/api/kg/test-in-flight", fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    resolveRequest(["shared"]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      ["shared"],
      ["shared"],
    ]);
  });

  it("expires responses after 30 seconds and lets refresh bypass cache", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(["first"])
      .mockResolvedValueOnce(["second"])
      .mockResolvedValueOnce(["fresh"]);
    const url = "/api/kg/test-expiry";

    await expect(fetchKgResource(url, fetcher)).resolves.toEqual(["first"]);
    await expect(fetchKgResource(url, fetcher)).resolves.toEqual(["first"]);
    vi.advanceTimersByTime(30_001);
    await expect(fetchKgResource(url, fetcher)).resolves.toEqual(["second"]);
    await expect(fetchKgResource(url, fetcher, true)).resolves.toEqual(["fresh"]);

    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
