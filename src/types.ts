/**
 * Shared, dependency-free type definitions for the whole app.
 * Kept in one place so every module (agents, routing, session, usage)
 * speaks the same vocabulary without importing from each other.
 */

export type AgentName = "claude" | "codex";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** One named preset: which agent, which model, how much effort. */
export interface ModeConfig {
  agent: AgentName;
  model: string;
  effort?: Effort;
  /** Whether this mode may use tools that run commands or edit files.
   * Defaults to true (read-only, no Bash/Edit/Write) when omitted - there
   * is no interactive human to approve a permission prompt when running
   * headless, so read-only is the safe default. A mode must explicitly
   * set `readOnly: false` to allow real changes. */
  readOnly?: boolean;
  /** True for modes expensive enough that a confidently-wrong semantic
   * match still shouldn't auto-commit to them - EmbeddingResolver declines
   * (defers to LLM escalation for a second opinion) when it's about to
   * switch INTO such a mode, though it keeps trusting itself once you're
   * already there (no re-confirmation every turn). Manual override always
   * bypasses this, since that's deliberate user intent either way. */
  expensive?: boolean;
}

export interface ModesFile {
  default: string;
  modes: Record<string, ModeConfig>;
}

/** What an agent adapter is asked to do for a single turn. */
export interface AgentRunOptions {
  prompt: string;
  model?: string;
  effort?: Effort;
  /** Existing session id to resume on this agent, if any. */
  resumeSessionId?: string;
  /** Working directory the agent CLI should operate in. */
  cwd?: string;
  /** Called with a short, human-readable line as the agent makes progress
   * (thinking, using a tool, etc.) - purely for live display, never parsed
   * or relied on for the final result. */
  onEvent?: (message: string) => void;
  /** true (or omitted) = no command/file-editing tools allowed. false =
   * this turn may run commands / write files, scoped to cwd. */
  readOnly?: boolean;
  /** Aborting this cancels the in-flight CLI subprocess. */
  signal?: AbortSignal;
}

/** What an agent adapter reports back after a turn. */
export interface AgentRunResult {
  text: string;
  /** Session id to persist for future --resume calls on this agent. */
  sessionId?: string;
  /** Direct cost report from the CLI, if it provides one (Claude does). */
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Raw parsed payload, kept for debugging / future fields. */
  raw?: unknown;
}

/** How a routing decision was reached - useful for the status line & logs. */
export type RoutingSource =
  | "override"
  | "sticky"
  | "embedding"
  | "llm-escalation"
  | "default";

export interface RoutingDecision {
  mode: string;
  agent: AgentName;
  model: string;
  effort?: Effort;
  readOnly: boolean;
  /** True only when this turn's prompt explicitly forced the model via
   * "!model=" - lets a sticky quick-switch (Shift+Tab) model override
   * apply everywhere else without clobbering a deliberate one-turn
   * override. */
  explicitModel?: boolean;
  source: RoutingSource;
  confidence?: number;
  reason?: string;
  /** Prompt with any override tokens (e.g. "!codex") stripped out. */
  cleanedPrompt: string;
}

/** Context handed to each routing resolver in the chain. */
export interface RoutingContext {
  rawPrompt: string;
  recentPrompts: string[];
  currentMode: string | null;
}

export interface UsageEntry {
  timestamp: string;
  agent: AgentName;
  model: string;
  mode: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  /** True for internal middleman/escalation calls, not user-visible turns. */
  internal: boolean;
}
