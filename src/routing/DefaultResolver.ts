import type { ModeResolver } from "./ModeResolver.js";
import type { ModesFile, RoutingContext, RoutingDecision } from "../types.js";

/**
 * End of the chain: always produces a decision (the configured default
 * mode), so Router never runs out of resolvers to try.
 */
export class DefaultResolver implements ModeResolver {
  constructor(private readonly modesFile: ModesFile) {}

  async resolve(ctx: RoutingContext): Promise<RoutingDecision> {
    const cfg = this.modesFile.modes[this.modesFile.default];
    return {
      mode: this.modesFile.default,
      agent: cfg.agent,
      model: cfg.model,
      effort: cfg.effort,
      source: "default",
      reason: "no override, confident semantic match, or escalation result - using default mode",
      cleanedPrompt: ctx.rawPrompt,
    };
  }
}
