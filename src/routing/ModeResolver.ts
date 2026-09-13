import type { RoutingContext, RoutingDecision } from "../types.js";

/**
 * One link in the routing chain-of-responsibility. Each resolver either
 * confidently decides (returns a RoutingDecision) or declines (returns
 * null), letting the next resolver in the chain try. Adding a new routing
 * strategy means writing one new class implementing this interface and
 * inserting it into the chain built in index.ts - no edits to Router or
 * to any other resolver (Open/Closed).
 */
export interface ModeResolver {
  resolve(ctx: RoutingContext): Promise<RoutingDecision | null>;
}
