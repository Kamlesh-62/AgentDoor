import type { PricingFile } from "../config/loadPricing.js";

/** Approximates USD cost from token counts when an agent doesn't report
 * cost directly. Unknown models fall back to the "unknown" (zero) rate
 * rather than throwing, so a missing pricing entry degrades to "$0
 * estimated" instead of crashing a turn. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: PricingFile,
): number {
  const rate = pricing.models[model] ?? pricing.models["unknown"] ?? {
    inputPer1M: 0,
    outputPer1M: 0,
  };
  return (
    (inputTokens / 1_000_000) * rate.inputPer1M +
    (outputTokens / 1_000_000) * rate.outputPer1M
  );
}
