import chalk from "chalk";
import type { AgentRunResult, RoutingDecision } from "../types.js";
import { agentColor } from "./colors.js";

/** One compact line printed after each turn's response. */
export function renderStatusLine(decision: RoutingDecision, result: AgentRunResult): string {
  const agentLabel = agentColor(decision.agent)(`agent:${decision.agent}`);
  const parts = [chalk.dim(`mode:${decision.mode}`), agentLabel, chalk.dim(`model:${decision.model}`)];
  if (decision.effort) parts.push(chalk.dim(`effort:${decision.effort}`));
  if (result.sessionId) parts.push(chalk.dim(`session:${result.sessionId.slice(0, 8)}`));
  if (typeof result.costUsd === "number") parts.push(chalk.dim(`cost:$${result.costUsd.toFixed(4)}`));
  parts.push(chalk.dim(`via:${decision.source}`));

  return chalk.dim("[") + parts.join(chalk.dim(" · ")) + chalk.dim("]");
}
