import "server-only";

const pricesPerMillion: Record<string, { input: number; output: number }> = {
  "openai:gpt-5-mini": { input: 0.25, output: 2 },
  "anthropic:claude-sonnet-5": { input: 2, output: 10 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = pricesPerMillion[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
