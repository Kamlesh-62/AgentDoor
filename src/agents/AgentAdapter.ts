import type { AgentName, AgentRunOptions, AgentRunResult, AuthStatus } from "../types.js";

/**
 * Contract every backend CLI wrapper must satisfy. The rest of the app
 * (Dispatcher, Router, UsageTracker) only ever depends on this interface,
 * never on ClaudeAgent/CodexAgent/GrokAgent directly - so adding a fourth
 * backend later means writing one new class and registering it, with zero
 * edits to existing code (Open/Closed).
 */
export interface AgentAdapter {
  readonly name: AgentName;
  run(options: AgentRunOptions): Promise<AgentRunResult>;
  /** Cheap, free preflight check (binary present, logged in) - never
   * spends a model call. Called before a real dispatch so "not logged in"
   * or "not installed" surfaces as a clear message instead of a raw CLI
   * error after already trying. */
  checkAuth(): Promise<AuthStatus>;
}
