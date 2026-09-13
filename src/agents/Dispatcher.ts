import type { AgentRegistry } from "./AgentRegistry.js";
import type { SessionStore } from "../session/SessionStore.js";
import type { AgentRunResult, RoutingDecision } from "../types.js";

/**
 * Turns a RoutingDecision into an actual CLI invocation: looks up the
 * right adapter, resumes that agent's own session if one exists, and
 * persists whatever session id comes back. This is the only place that
 * ties routing decisions to session continuity - Router/resolvers never
 * touch SessionStore directly.
 */
export class Dispatcher {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly sessionStore: SessionStore,
    private readonly cwd?: string,
  ) {}

  async dispatch(
    decision: RoutingDecision,
    onEvent?: (message: string) => void,
    signal?: AbortSignal,
  ): Promise<AgentRunResult> {
    const adapter = this.registry.get(decision.agent);
    const resumeSessionId = this.sessionStore.get(decision.agent);

    const result = await adapter.run({
      prompt: decision.cleanedPrompt,
      model: decision.model,
      effort: decision.effort,
      resumeSessionId,
      cwd: this.cwd,
      onEvent,
      readOnly: decision.readOnly,
      signal,
    });

    this.sessionStore.set(decision.agent, result.sessionId);
    return result;
  }
}
