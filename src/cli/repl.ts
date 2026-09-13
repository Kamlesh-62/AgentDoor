import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { Router } from "../routing/Router.js";
import type { Dispatcher } from "../agents/Dispatcher.js";
import type { UsageTracker } from "../usage/UsageTracker.js";
import type { RoutingStateStore } from "../session/RoutingStateStore.js";
import { renderStatusLine } from "../ui/StatusLine.js";
import { renderSessionSummary } from "../ui/SessionSummary.js";

export interface ReplDeps {
  router: Router;
  dispatcher: Dispatcher;
  usageTracker: UsageTracker;
  stateStore: RoutingStateStore;
}

/** Runs one turn end-to-end: route, (maybe) dispatch, record usage, report. */
export async function runTurn(rawPrompt: string, deps: ReplDeps): Promise<void> {
  const ctx = {
    rawPrompt,
    recentPrompts: [...deps.stateStore.recentPrompts],
    currentMode: deps.stateStore.activeMode,
  };
  const decision = await deps.router.resolve(ctx);

  if (!decision.cleanedPrompt) {
    // A pure override, e.g. "/mode backend" with nothing else - just switch.
    deps.stateStore.setActiveMode(decision.mode);
    console.log(chalk.dim(`(switched to mode "${decision.mode}", nothing dispatched)`));
    return;
  }

  const result = await deps.dispatcher.dispatch(decision);
  deps.usageTracker.record({
    agent: decision.agent,
    model: decision.model,
    mode: decision.mode,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  });
  deps.stateStore.setActiveMode(decision.mode);
  deps.stateStore.recordPrompt(rawPrompt);

  console.log("\n" + result.text.trim() + "\n");
  console.log(renderStatusLine(decision, result));
}

export async function startRepl(deps: ReplDeps): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("you> "),
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const summary = deps.usageTracker.persistSessionSummary();
    console.log("\n" + renderSessionSummary(summary));
  };

  process.on("SIGINT", () => {
    finish();
    process.exit(0);
  });

  console.log(
    chalk.dim(
      "agent-router ready. Commands: /mode <name>, !claude, !codex, !model=<name>, !effort=<level>, /exit\n",
    ),
  );
  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      continue;
    }
    if (line === "/exit" || line === "/quit") break;

    try {
      await runTurn(line, deps);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
    rl.prompt();
  }

  rl.close();
  finish();
}
