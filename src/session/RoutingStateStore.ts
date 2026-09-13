import { JsonFileStore } from "./JsonFileStore.js";

interface RoutingState {
  activeMode: string | null;
  recentPrompts: string[];
}

const MAX_RECENT_PROMPTS = 5;

/**
 * Small, routing-only memory: which mode is currently "sticky", and the
 * last few raw prompts (for the embedding/escalation resolvers to use as
 * context). This is NOT a conversation transcript and is never fed back
 * into an agent as content - it only helps the router decide, on its own,
 * whether to switch modes. Persists across restarts so mode stickiness
 * survives closing and reopening the tool.
 */
export class RoutingStateStore {
  private readonly store: JsonFileStore<RoutingState>;
  private state: RoutingState;

  constructor(filePath: string) {
    this.store = new JsonFileStore<RoutingState>(filePath, {
      activeMode: null,
      recentPrompts: [],
    });
    this.state = this.store.load();
  }

  get activeMode(): string | null {
    return this.state.activeMode;
  }

  get recentPrompts(): readonly string[] {
    return this.state.recentPrompts;
  }

  setActiveMode(mode: string): void {
    this.state.activeMode = mode;
    this.store.save(this.state);
  }

  recordPrompt(prompt: string): void {
    this.state.recentPrompts.push(prompt);
    if (this.state.recentPrompts.length > MAX_RECENT_PROMPTS) {
      this.state.recentPrompts = this.state.recentPrompts.slice(-MAX_RECENT_PROMPTS);
    }
    this.store.save(this.state);
  }
}
