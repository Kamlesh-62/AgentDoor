import chalk from "chalk";
import type { RoutingDecision } from "../types.js";
import { agentColor } from "./colors.js";

/**
 * One agent runs per turn (routing already picked it), so this is a single
 * live indicator, not a two-pane split - it just labels whichever agent is
 * currently active and streams its progress underneath, replacing the
 * previous silence-until-done behavior. Colored per-agent so which one is
 * running is recognizable at a glance without reading the label.
 */
export class LiveBox {
  start(decision: RoutingDecision): void {
    const color = agentColor(decision.agent);
    const header = [decision.agent, decision.model];
    if (decision.effort) header.push(`effort:${decision.effort}`);
    if (!decision.readOnly) header.push("write-enabled");
    console.log(color(`\n┌─ ${header.join(" · ")} ─`));
  }

  /** Prints one live progress line under the header. */
  event(message: string): void {
    console.log(chalk.dim(`│ ${message}`));
  }

  end(decision: RoutingDecision): void {
    console.log(agentColor(decision.agent)("└─"));
  }
}
