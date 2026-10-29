export interface MemoryCardSearchDisplay {
  query: string;
  count: number;
  snippets: string[];
}

export function memoryCardSearchDisplay(
  payload?: Record<string, unknown>,
): MemoryCardSearchDisplay | null {
  const results = payload?.results;
  if (!Array.isArray(results)) return null;

  const snippets = results.slice(0, 3).flatMap((result) => {
    if (!result || typeof result !== "object" || !("snippet" in result)) return [];
    return typeof result.snippet === "string" ? [result.snippet] : [];
  });

  return {
    query: typeof payload?.query === "string" ? payload.query : "",
    count: typeof payload?.count === "number" ? payload.count : results.length,
    snippets,
  };
}
