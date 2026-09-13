import chalk from "chalk";
import type { AgentRunResult, RoutingDecision } from "../types.js";

/** One compact line printed after each turn's response. */
export function renderStatusLine(decision: RoutingDecision, result: AgentRunResult): string {
  const parts = [
    `mode:${decision.mode}`,
    `agent:${decision.agent}`,
    `model:${decision.model}`,
  ];
  if (decision.effort) parts.push(`effort:${decision.effort}`);
  if (result.sessionId) parts.push(`session:${result.sessionId.slice(0, 8)}`);
  if (typeof result.costUsd === "number") parts.push(`cost:$${result.costUsd.toFixed(4)}`);
  parts.push(`via:${decision.source}`);

  return chalk.dim(`[${parts.join(" · ")}]`);
}
