import chalk from "chalk";
import type { RoutingDecision } from "../types.js";

/**
 * One agent runs per turn (routing already picked it), so this is a single
 * live indicator, not a two-pane split - it just labels whichever agent is
 * currently active and streams its progress underneath, replacing the
 * previous silence-until-done behavior.
 */
export class LiveBox {
  private lineCount = 0;

  start(decision: RoutingDecision): void {
    const header = [`${decision.agent}`, `${decision.model}`];
    if (decision.effort) header.push(`effort:${decision.effort}`);
    console.log(chalk.cyan(`\n┌─ ${header.join(" · ")} ─`));
    this.lineCount = 0;
  }

  /** Prints one live progress line under the header. */
  event(message: string): void {
    console.log(chalk.dim(`│ ${message}`));
    this.lineCount++;
  }

  end(): void {
    console.log(chalk.cyan("└─"));
  }
}
