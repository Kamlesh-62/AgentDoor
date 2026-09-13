import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { Router } from "../routing/Router.js";
import type { Dispatcher } from "../agents/Dispatcher.js";
import type { UsageTracker } from "../usage/UsageTracker.js";
import type { RoutingStateStore } from "../session/RoutingStateStore.js";
import { renderStatusLine } from "../ui/StatusLine.js";
import { renderSessionSummary } from "../ui/SessionSummary.js";
import { LiveBox } from "../ui/LiveBox.js";
import { CancelledError } from "../utils/spawn.js";

export interface ReplDeps {
  router: Router;
  dispatcher: Dispatcher;
  usageTracker: UsageTracker;
  stateStore: RoutingStateStore;
}

/** Runs one turn end-to-end: route, (maybe) dispatch, record usage, report.
 * Pass `signal` so the caller can cancel the in-flight subprocess (e.g. on
 * Ctrl+C) without killing the whole process. */
export async function runTurn(
  rawPrompt: string,
  deps: ReplDeps,
  signal?: AbortSignal,
): Promise<void> {
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

  const liveBox = new LiveBox();
  liveBox.start(decision);
  const result = await deps.dispatcher.dispatch(
    decision,
    (message) => liveBox.event(message),
    signal,
  );
  liveBox.end();

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

  // Tracks the currently in-flight turn's controller, if any. First
  // Ctrl+C while a turn is running cancels just that turn (kills the
  // subprocess, stays in the REPL); Ctrl+C while idle exits normally -
  // matches ordinary shell muscle memory (cancel job vs. quit shell).
  let currentController: AbortController | null = null;

  process.on("SIGINT", () => {
    if (currentController && !currentController.signal.aborted) {
      currentController.abort();
      console.log(chalk.yellow("\n(cancelled - subprocess stopped)"));
      return;
    }
    finish();
    process.exit(0);
  });

  console.log(
    chalk.dim(
      "agent-router ready. Commands: /mode <name>, !claude, !codex, !model=<name>, " +
        "!effort=<level>, !write, /exit. Ctrl+C cancels the current turn; Ctrl+C again (idle) exits.\n",
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

    currentController = new AbortController();
    try {
      await runTurn(line, deps, currentController.signal);
    } catch (err) {
      if (!(err instanceof CancelledError)) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
      }
      // CancelledError: the SIGINT handler already printed the notice.
    } finally {
      currentController = null;
    }
    rl.prompt();
  }

  rl.close();
  finish();
}
