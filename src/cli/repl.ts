import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import chalk from "chalk";
import type { Router } from "../routing/Router.js";
import type { Dispatcher } from "../agents/Dispatcher.js";
import type { UsageTracker } from "../usage/UsageTracker.js";
import type { RoutingStateStore } from "../session/RoutingStateStore.js";
import type { SessionStore } from "../session/SessionStore.js";
import type { ModesFile } from "../types.js";
import { renderStatusLine } from "../ui/StatusLine.js";
import { renderSessionSummary } from "../ui/SessionSummary.js";
import { renderStatus, renderModes } from "../ui/StatusPanel.js";
import { LiveBox } from "../ui/LiveBox.js";
import { agentColor } from "../ui/colors.js";
import { CancelledError } from "../utils/spawn.js";
import { getModelsForAgent, nextModel, nextMode } from "./modelCatalog.js";

export interface ReplDeps {
  router: Router;
  dispatcher: Dispatcher;
  usageTracker: UsageTracker;
  stateStore: RoutingStateStore;
  sessionStore: SessionStore;
  modesFile: ModesFile;
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

  // A sticky quick-switch model (Shift+Tab) applies unless this turn
  // explicitly forced its own model via "!model=", or the model doesn't
  // even belong to whichever agent this turn resolved to (e.g. semantic
  // routing picked a different mode/agent than the one the model was
  // cycled for) - deliberate one-turn intent, and agent/model validity,
  // both win over the standing quick-switch choice.
  const stickyModel = deps.stateStore.modelOverride;
  if (stickyModel && !decision.explicitModel) {
    const validModels = getModelsForAgent(deps.modesFile, decision.agent);
    if (validModels.includes(stickyModel)) decision.model = stickyModel;
  }

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
  liveBox.end(decision);

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

/** Builds the "you [mode·agent]>" prompt string reflecting current sticky
 * state, so you always know what the next prompt will route to without
 * waiting for a response. */
function buildPrompt(deps: ReplDeps): string {
  const mode = deps.stateStore.activeMode;
  if (!mode) return chalk.cyan("you> ");
  const cfg = deps.modesFile.modes[mode];
  const agentTag = cfg ? agentColor(cfg.agent)(cfg.agent) : "";
  const model = deps.stateStore.modelOverride ?? cfg?.model;
  const tags = [mode, agentTag, model].filter(Boolean).join("·");
  return chalk.cyan(`you [${tags}]> `);
}

const HELP_TEXT = [
  "agent-router ready. Commands:",
  "  /mode <name>     switch sticky mode",
  "  /status          show active mode, sessions, cost so far",
  "  /modes           list configured modes",
  "  !claude / !codex force the agent for one turn",
  "  !model=<name>    force the model for one turn",
  "  !effort=<level>  force the effort for one turn",
  "  !write           allow this turn to run commands/edit files",
  "  /exit            quit (prints cost summary)",
  "Ctrl+C cancels the current turn; press it twice quickly while idle to exit.",
].join("\n");

/**
 * Tab cycles through configured modes; Shift+Tab cycles through models
 * valid for the current (or default) mode's agent. Both are quick
 * shortcuts for what "/mode <name>" and "!model=<name>" already do -
 * nothing here is a new routing mechanism, just a faster way to reach it.
 * No-ops entirely on non-TTY input (piped stdin, tests) since raw keypress
 * mode requires a real terminal.
 */
function setupQuickSwitchKeys(rl: ReturnType<typeof createInterface>, deps: ReplDeps): void {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") return;

  // readline's own Interface already calls this internally for a TTY, but
  // it's idempotent - calling it again just ensures our listener below
  // sees keypress events regardless of that internal detail.
  emitKeypressEvents(input);
  input.setRawMode(true);

  input.on("keypress", (_str, key) => {
    if (!key || key.name !== "tab") return;

    if (key.shift) {
      const modeName = deps.stateStore.activeMode ?? deps.modesFile.default;
      const modeCfg = deps.modesFile.modes[modeName];
      const models = getModelsForAgent(deps.modesFile, modeCfg.agent);
      const current = deps.stateStore.modelOverride ?? modeCfg.model;
      const next = nextModel(models, current);
      if (next && next !== current) {
        deps.stateStore.setModelOverride(next);
        redrawPrompt(rl, deps, `(model -> ${next})`);
      }
    } else {
      const next = nextMode(deps.modesFile, deps.stateStore.activeMode);
      deps.stateStore.setActiveMode(next);
      redrawPrompt(rl, deps, `(mode -> ${next})`);
    }
  });
}

/** Redraws the prompt (and whatever the user had already typed) in place
 * after a mode/model quick-switch, using readline's undocumented
 * _refreshLine when available and falling back to a plain re-prompt
 * otherwise (still functional, just less seamless). */
function redrawPrompt(rl: ReturnType<typeof createInterface>, deps: ReplDeps, note: string): void {
  rl.setPrompt(buildPrompt(deps));
  const refresh = (rl as unknown as { _refreshLine?: () => void })._refreshLine;
  if (typeof refresh === "function") {
    console.log(chalk.dim("\n" + note));
    refresh.call(rl);
  } else {
    console.log(chalk.dim(note));
    rl.prompt();
  }
}

/** Prompts again only if the interface is still open. With piped input,
 * stdin can finish and close the interface WHILE a slow turn is still
 * running - by the time that turn's response prints, rl.prompt() would
 * throw "readline was closed" instead of being a no-op. Since there's no
 * more input coming once closed anyway, skipping is exactly correct, not
 * just a crash-avoidance shrug. */
function safePrompt(rl: ReturnType<typeof createInterface>): void {
  // `closed` exists at runtime (verified: undefined until close(), then
  // true) but isn't in this Node's @types/node yet - hence the cast.
  if (!(rl as unknown as { closed?: boolean }).closed) rl.prompt();
}

export async function startRepl(deps: ReplDeps): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(deps),
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
  // subprocess, stays in the REPL). While idle, a single Ctrl+C no longer
  // exits immediately - it warns and arms a short window; only a second
  // Ctrl+C within that window actually exits, matching the "press again to
  // exit" convention most REPLs use so one accidental Ctrl+C doesn't lose
  // your session.
  let currentController: AbortController | null = null;
  const EXIT_CONFIRM_WINDOW_MS = 2000;
  let idleSigintAt: number | null = null;

  process.on("SIGINT", () => {
    if (currentController && !currentController.signal.aborted) {
      currentController.abort();
      console.log(chalk.yellow("\n(cancelled - subprocess stopped)"));
      return;
    }

    const now = Date.now();
    if (idleSigintAt && now - idleSigintAt < EXIT_CONFIRM_WINDOW_MS) {
      finish();
      process.exit(0);
    }
    idleSigintAt = now;
    console.log(chalk.yellow("\n(press Ctrl+C again to exit)"));
    safePrompt(rl);
  });

  setupQuickSwitchKeys(rl, deps);

  console.log(chalk.dim(HELP_TEXT) + "\n");
  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) {
      safePrompt(rl);
      continue;
    }
    if (line === "/exit" || line === "/quit") break;

    if (line === "/status") {
      console.log(
        "\n" +
          renderStatus(deps.modesFile, deps.stateStore, deps.sessionStore, deps.usageTracker) +
          "\n",
      );
      rl.setPrompt(buildPrompt(deps));
      safePrompt(rl);
      continue;
    }
    if (line === "/modes") {
      console.log("\n" + renderModes(deps.modesFile) + "\n");
      safePrompt(rl);
      continue;
    }

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
    rl.setPrompt(buildPrompt(deps)); // reflects any mode change from this turn
    safePrompt(rl);
  }

  rl.close();
  finish();
}
