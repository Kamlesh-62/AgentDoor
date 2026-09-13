import chalk from "chalk";
import type { ModesFile } from "../types.js";
import type { RoutingStateStore } from "../session/RoutingStateStore.js";
import type { SessionStore } from "../session/SessionStore.js";
import type { UsageTracker } from "../usage/UsageTracker.js";
import { agentColor } from "./colors.js";

/** Renders the "/status" command output: what mode is active right now,
 * both agents' session ids, and running cost for this REPL session. */
export function renderStatus(
  modesFile: ModesFile,
  stateStore: RoutingStateStore,
  sessionStore: SessionStore,
  usageTracker: UsageTracker,
): string {
  const lines: string[] = [];

  const activeMode = stateStore.activeMode;
  if (activeMode) {
    const cfg = modesFile.modes[activeMode];
    const remainingMs = stateStore.stickyMsRemaining;
    const remainingMin = remainingMs ? Math.ceil(remainingMs / 60000) : null;
    lines.push(
      chalk.bold(`Active mode: ${activeMode}`) +
        ` (${agentColor(cfg.agent)(cfg.agent)}/${cfg.model}${cfg.effort ? `, effort:${cfg.effort}` : ""})` +
        (remainingMin ? chalk.dim(` - expires in ~${remainingMin}m of inactivity`) : ""),
    );
  } else {
    lines.push(chalk.bold(`Active mode: none`) + chalk.dim(` (next prompt uses "${modesFile.default}" or semantic routing)`));
  }

  lines.push("");
  lines.push(chalk.bold("Sessions:"));
  for (const agent of ["claude", "codex"] as const) {
    const sessionId = sessionStore.get(agent);
    lines.push(
      `  ${agentColor(agent)(agent.padEnd(6))} ${sessionId ? sessionId.slice(0, 8) : chalk.dim("(none yet)")}`,
    );
  }

  const summary = usageTracker.summarize();
  lines.push("");
  lines.push(chalk.bold(`Cost so far this session: ~$${summary.totalCostUsd.toFixed(4)} (${summary.totalTurns} turns)`));

  return lines.join("\n");
}

/** Renders the "/modes" command output: every configured mode and its
 * {agent, model, effort, readOnly}, without needing to open the YAML. */
export function renderModes(modesFile: ModesFile): string {
  const lines = [chalk.bold("Configured modes:")];
  for (const [name, cfg] of Object.entries(modesFile.modes)) {
    const isDefault = name === modesFile.default;
    const tags = [
      agentColor(cfg.agent)(cfg.agent),
      cfg.model,
      cfg.effort ? `effort:${cfg.effort}` : null,
      cfg.readOnly === false ? chalk.yellow("write-enabled") : null,
    ].filter(Boolean);
    lines.push(`  ${name.padEnd(10)} ${tags.join(" · ")}${isDefault ? chalk.dim("  (default)") : ""}`);
  }
  return lines.join("\n");
}
