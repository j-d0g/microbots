import "server-only";

const pricesPerMillion: Record<string, { input: number; output: number }> = {
  "openai:gpt-6-luna": { input: 0.1, output: 0.5 },
  "anthropic:claude-sonnet-5": { input: 2, output: 10 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = pricesPerMillion[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
