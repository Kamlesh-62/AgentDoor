import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import chalk from "chalk";
import type { Router } from "../routing/Router.js";
import type { Dispatcher } from "../agents/Dispatcher.js";
import type { UsageTracker } from "../usage/UsageTracker.js";
import type { RoutingStateStore } from "../session/RoutingStateStore.js";
import type { SessionStore } from "../session/SessionStore.js";
import type { ModesFile } from "../types.js";
import type { AgentRegistry } from "../agents/AgentRegistry.js";
import { renderStatusLine } from "../ui/StatusLine.js";
import { renderSessionSummary } from "../ui/SessionSummary.js";
import { renderStatus, renderModes } from "../ui/StatusPanel.js";
import { LiveBox } from "../ui/LiveBox.js";
import { agentColor } from "../ui/colors.js";
import { CancelledError } from "../utils/spawn.js";
import { AgentUnavailableError } from "../agents/errors.js";
import { getModelsForAgent, nextModel, nextMode } from "./modelCatalog.js";
import { runDoctorChecks, renderDoctorReport } from "./doctor.js";

export interface ReplDeps {
  router: Router;
  dispatcher: Dispatcher;
  usageTracker: UsageTracker;
  stateStore: RoutingStateStore;
  sessionStore: SessionStore;
  modesFile: ModesFile;
  registry: AgentRegistry;
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

/** Builds the prompt as a small status chip ahead of the cursor. Three
 * pieces of state matter here, and they're deliberately NOT given equal
 * weight (the old design joined mode·agent·model in one color via middle
 * dots, which reads as one blob and buries the one fact that's actually
 * consequential to notice before typing):
 *
 *  - the dot is read-only vs. write-capable (see README "Tool
 *    permissions") - hollow/dim when this mode can only look, filled/red
 *    when it can run commands or edit files. That's the one thing worth
 *    a glance on every turn, so it gets the one semantic (non-brand)
 *    color on the line, matching how SIGINT notices already use
 *    chalk.yellow rather than a custom hex for system state.
 *  - the mode name stays dim - it's context, not the actor.
 *  - agent/model is the actual actor, so it's the only agent-colored text.
 *
 * No mode set yet falls back to a plain, undecorated prompt - there's
 * nothing to show. */
function buildPrompt(deps: ReplDeps): string {
  const mode = deps.stateStore.activeMode;
  if (!mode) return chalk.dim("› ");

  const cfg = deps.modesFile.modes[mode];
  if (!cfg) return chalk.dim("› ");

  const color = agentColor(cfg.agent);
  const model = deps.stateStore.modelOverride ?? cfg.model;
  const readOnly = cfg.readOnly ?? true;
  const dot = readOnly ? chalk.dim("○") : chalk.red("●");

  return `${dot} ${chalk.dim(mode)} ${color(`${cfg.agent}/${model}`)} ${chalk.dim("›")} `;
}

const HELP_TEXT = [
  "AgentDoor ready. Commands:",
  "  /mode <name>     switch sticky mode",
  "  /status          show active mode, sessions, cost so far",
  "  /modes           list configured modes",
  "  /doctor          check every agent's login/availability status",
  "  !claude / !codex force the agent for one turn",
  "  !model=<name>    force the model for one turn",
  "  !effort=<level>  force the effort for one turn",
  "  !write           allow this turn to run commands/edit files",
  "  /exit            quit (prints cost summary)",
  "Ctrl+C cancels the current turn; press it twice quickly while idle to exit.",
  "Ctrl+X clears whatever you've typed so far, in one keystroke.",
  "A long paste collapses to a placeholder; paste again to reveal it.",
  "End a line with \\ to keep writing on the next line before submitting.",
].join("\n");

const PASTE_COLLAPSE_THRESHOLD = 40;

interface PasteCollapser {
  /** Swaps a still-collapsed placeholder back to the real pasted text.
   * Called right before a submitted line is dispatched, so the agent
   * always sees what was actually pasted - never the placeholder. */
  expand(line: string): string;
}

/**
 * Collapses a long paste into a one-line placeholder (`«pasted N
 * chars»`) instead of dumping a wall of text into the prompt, and
 * expands it back either on a second paste (a "let me see that again"
 * gesture) or right before the line is submitted.
 *
 * Deliberately scoped to single-line pastes only (no embedded newline in
 * the pasted chunk). Node's `readline` has no built-in awareness of
 * bracketed-paste markers, so a paste containing a newline already
 * submits early today, one "line" at a time, exactly as if it had been
 * typed by hand with Enter pressed partway through - that's pre-existing
 * behavior this doesn't touch. Handling that properly means intercepting
 * raw paste bytes before readline ever decodes them (detaching its stdin
 * listener mid-paste); this stays out of that territory entirely, so it
 * can't regress paste/typing that already works.
 *
 * Detection is a size heuristic, not a paste-specific signal: any single
 * "data" chunk at or above PASTE_COLLAPSE_THRESHOLD chars, with no
 * newline or escape byte in it, is treated as a paste. A human typing
 * that fast in one chunk is not a realistic false positive.
 */
function setupPasteCollapsing(
  rl: ReturnType<typeof createInterface>,
  input: NodeJS.ReadStream,
): PasteCollapser {
  let pending: { placeholder: string; text: string } | null = null;
  if (!input.isTTY) return { expand: (line) => line };

  // Registered after createInterface() already attached its own "data"
  // listener, so by the time this runs, readline has already inserted
  // the chunk into its line buffer and redrawn - this only ever swaps
  // already-inserted text for a placeholder, never intercepts input.
  input.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString("utf8");
    if (text.length < PASTE_COLLAPSE_THRESHOLD) return;
    if (/[\n\r\x1b]/.test(text)) return; // multi-line or a control sequence - leave to readline as-is

    const line = rl as unknown as { line: string; cursor: number; _refreshLine?: () => void };

    // A second paste while a placeholder from the first is still in the
    // line: reveal it instead of collapsing this new chunk on top of it.
    // The newly-inserted chunk is discarded (it's redundant - pasting the
    // same clipboard content again would just duplicate what "text" here
    // already holds it as).
    if (pending && line.line.includes(pending.placeholder)) {
      const insertStart = line.cursor - text.length;
      if (line.line.slice(insertStart, line.cursor) !== text) return; // unexpected state - fail open
      const withoutChunk = line.line.slice(0, insertStart) + line.line.slice(line.cursor);
      const phIdx = withoutChunk.indexOf(pending.placeholder);
      if (phIdx === -1) return;
      line.line = withoutChunk.slice(0, phIdx) + pending.text + withoutChunk.slice(phIdx + pending.placeholder.length);
      line.cursor = phIdx + pending.text.length;
      pending = null;
      line._refreshLine?.();
      return;
    }

    const insertStart = line.cursor - text.length;
    if (line.line.slice(insertStart, line.cursor) !== text) return; // unexpected state - fail open

    const placeholder = `«pasted ${text.length} chars»`;
    line.line = line.line.slice(0, insertStart) + placeholder + line.line.slice(line.cursor);
    line.cursor = insertStart + placeholder.length;
    pending = { placeholder, text };
    line._refreshLine?.();
  });

  return {
    expand: (submitted) => {
      if (!pending || !submitted.includes(pending.placeholder)) return submitted;
      return submitted.replace(pending.placeholder, pending.text);
    },
  };
}

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
    if (!key) return;

    // One-shot "clear the whole line" - the terminal equivalent of
    // select-all + delete. Ctrl+X is unbound by Node's readline defaults
    // (unlike Ctrl+U, which only kills from the cursor back to the start),
    // so this adds a shortcut instead of silently changing one you're
    // already relying on.
    if (key.ctrl && key.name === "x") {
      const line = rl as unknown as { line: string; cursor: number; _refreshLine?: () => void };
      line.line = "";
      line.cursor = 0;
      line._refreshLine?.();
      return;
    }

    if (key.name !== "tab") return;

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
  const pasteCollapser = setupPasteCollapsing(rl, process.stdin);

  console.log(chalk.dim(HELP_TEXT) + "\n");
  rl.prompt();

  // Holds lines-so-far while a backslash-continued prompt is being typed;
  // null means "not currently continuing".
  let continuation: string | null = null;

  for await (const rawLine of rl) {
    const piece = pasteCollapser.expand(rawLine.trim());

    // A trailing "\" means "more coming" instead of submit - the same
    // line-continuation convention a shell uses. This is the practical
    // stand-in for Shift+Enter: terminals send the same byte for Enter
    // and Shift+Enter (there's no reliable way to tell them apart across
    // terminals), but every terminal can type a literal backslash, so
    // this works everywhere rather than only on terminals that happen to
    // support an extended keyboard protocol.
    if (piece.endsWith("\\")) {
      const withoutBackslash = piece.slice(0, -1).trimEnd();
      continuation = continuation === null ? withoutBackslash : `${continuation}\n${withoutBackslash}`;
      rl.setPrompt(chalk.dim("… "));
      rl.prompt();
      continue;
    }

    const line = continuation === null ? piece : `${continuation}\n${piece}`;
    continuation = null;
    rl.setPrompt(buildPrompt(deps)); // back to the normal chip now that continuation (if any) is over

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
      safePrompt(rl);
      continue;
    }
    if (line === "/modes") {
      console.log("\n" + renderModes(deps.modesFile) + "\n");
      safePrompt(rl);
      continue;
    }
    if (line === "/doctor") {
      const results = await runDoctorChecks(deps.registry.all());
      console.log("\n" + renderDoctorReport(results) + "\n");
      safePrompt(rl);
      continue;
    }

    currentController = new AbortController();
    try {
      await runTurn(line, deps, currentController.signal);
    } catch (err) {
      if (err instanceof AgentUnavailableError) {
        // A known, actionable cause - plain statement, not a stack trace.
        console.error(chalk.yellow(`⚠ ${err.message}`));
      } else if (!(err instanceof CancelledError)) {
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
