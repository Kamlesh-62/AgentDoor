import type { AgentName, AgentRunOptions, AgentRunResult } from "../types.js";

/**
 * Contract every backend CLI wrapper must satisfy. The rest of the app
 * (Dispatcher, Router, UsageTracker) only ever depends on this interface,
 * never on ClaudeAgent/CodexAgent directly - so adding a third backend
 * later means writing one new class and registering it, with zero edits
 * to existing code (Open/Closed).
 */
export interface AgentAdapter {
  readonly name: AgentName;
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}
