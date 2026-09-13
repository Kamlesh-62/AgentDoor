import type { ModeResolver } from "./ModeResolver.js";
import type { RoutingContext, RoutingDecision } from "../types.js";

/**
 * Runs resolvers in order, first non-null decision wins. The chain itself
 * (which resolvers, in which order) is assembled by the caller (index.ts),
 * so this class never needs to change when the routing strategy changes.
 */
export class Router {
  constructor(private readonly resolvers: ModeResolver[]) {}

  async resolve(ctx: RoutingContext): Promise<RoutingDecision> {
    for (const resolver of this.resolvers) {
      const decision = await resolver.resolve(ctx);
      if (decision) return decision;
    }
    throw new Error(
      "Router: no resolver produced a decision. The chain must end with a resolver that always matches (e.g. DefaultResolver).",
    );
  }
}
