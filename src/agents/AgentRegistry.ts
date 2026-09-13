import type { AgentAdapter } from "./AgentAdapter.js";
import type { AgentName } from "../types.js";

/**
 * Looks up an AgentAdapter by name. Registration happens once at startup
 * (see index.ts); nothing downstream needs to know concrete classes exist -
 * adding a third backend is "write a class + register it here", not a
 * change to Router/Dispatcher.
 */
export class AgentRegistry {
  private readonly adapters = new Map<AgentName, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: AgentName): AgentAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(
        `No agent adapter registered for "${name}". Registered: ${[...this.adapters.keys()].join(", ") || "(none)"}`,
      );
    }
    return adapter;
  }
}
