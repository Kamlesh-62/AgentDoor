import chalk from "chalk";
import type { UsageSummary } from "../usage/UsageTracker.js";

/** Human-readable end-of-session cost/token breakdown. */
export function renderSessionSummary(summary: UsageSummary): string {
  if (summary.rows.length === 0) {
    return chalk.dim("No turns this session.");
  }

  const lines = [chalk.bold(`Session summary (${summary.totalTurns} turns)`)];
  for (const row of summary.rows) {
    const tag = `${row.agent}/${row.model}`;
    lines.push(
      `  ${tag.padEnd(20)} ${String(row.turns).padStart(3)} turns` +
        `  ~${(row.inputTokens + row.outputTokens).toLocaleString()} tokens` +
        `  ~$${row.costUsd.toFixed(4)}`,
    );
  }
  lines.push(chalk.bold(`  Total: ~$${summary.totalCostUsd.toFixed(4)}`));
  return lines.join("\n");
}
