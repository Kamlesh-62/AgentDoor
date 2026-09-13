import { JsonFileStore } from "./JsonFileStore.js";

interface RoutingState {
  activeMode: string | null;
  /** A model chosen via the Shift+Tab quick-switch, overriding the active
   * mode's configured model until the mode changes or this expires - same
   * lifecycle as activeMode, just one layer more specific. */
  modelOverride: string | null;
  /** ISO timestamp of the last turn (dispatched or mode-switched), used to
   * expire sticky mode after inactivity rather than letting it persist
   * forever - an old manual /mode override should not silently keep
   * routing prompts days or weeks later. */
  lastActivityAt: string | null;
  recentPrompts: string[];
}

const MAX_RECENT_PROMPTS = 5;
const DEFAULT_STICKY_TTL_MS = 30 * 60 * 1000; // 30 minutes of inactivity

/**
 * Small, routing-only memory: which mode is currently "sticky", and the
 * last few raw prompts (for the embedding/escalation resolvers to use as
 * context). This is NOT a conversation transcript and is never fed back
 * into an agent as content - it only helps the router decide, on its own,
 * whether to switch modes. Persists across restarts, but sticky mode
 * expires after `stickyTtlMs` of inactivity so it can't misroute a much
 * later, unrelated prompt.
 */
export class RoutingStateStore {
  private readonly store: JsonFileStore<RoutingState>;
  private state: RoutingState;

  constructor(
    filePath: string,
    private readonly stickyTtlMs: number = DEFAULT_STICKY_TTL_MS,
  ) {
    this.store = new JsonFileStore<RoutingState>(filePath, {
      activeMode: null,
      modelOverride: null,
      lastActivityAt: null,
      recentPrompts: [],
    });
    this.state = this.store.load();
  }

  /** Returns null if no mode is set, or if the sticky TTL has elapsed
   * since the last turn - callers should treat that exactly like "no
   * sticky mode" rather than distinguishing the two cases. */
  get activeMode(): string | null {
    if (this.state.activeMode === null) return null;
    if (this.isExpired()) {
      this.clearExpiredMode();
      return null;
    }
    return this.state.activeMode;
  }

  /** Same expiry rules as activeMode - a quick-switched model shouldn't
   * outlive the mode it was chosen within. */
  get modelOverride(): string | null {
    if (this.state.modelOverride === null) return null;
    if (this.isExpired()) {
      this.clearExpiredMode();
      return null;
    }
    return this.state.modelOverride;
  }

  get recentPrompts(): readonly string[] {
    return this.state.recentPrompts;
  }

  /** Milliseconds until sticky mode expires, or null if no mode is set
   * (already expired, or never set) - for /status display. */
  get stickyMsRemaining(): number | null {
    if (this.state.activeMode === null || !this.state.lastActivityAt) return null;
    const remaining = this.stickyTtlMs - (Date.now() - Date.parse(this.state.lastActivityAt));
    return remaining > 0 ? remaining : null;
  }

  setActiveMode(mode: string): void {
    this.state.activeMode = mode;
    // A new mode may imply a new agent, under which the previous model
    // override might not even be valid - start fresh on model each time.
    this.state.modelOverride = null;
    this.state.lastActivityAt = new Date().toISOString();
    this.store.save(this.state);
  }

  setModelOverride(model: string | null): void {
    this.state.modelOverride = model;
    this.state.lastActivityAt = new Date().toISOString();
    this.store.save(this.state);
  }

  recordPrompt(prompt: string): void {
    this.state.recentPrompts.push(prompt);
    if (this.state.recentPrompts.length > MAX_RECENT_PROMPTS) {
      this.state.recentPrompts = this.state.recentPrompts.slice(-MAX_RECENT_PROMPTS);
    }
    this.state.lastActivityAt = new Date().toISOString();
    this.store.save(this.state);
  }

  private isExpired(): boolean {
    if (!this.state.lastActivityAt) return false;
    const age = Date.now() - Date.parse(this.state.lastActivityAt);
    return age > this.stickyTtlMs;
  }

  private clearExpiredMode(): void {
    this.state.activeMode = null;
    this.state.modelOverride = null;
    this.store.save(this.state);
  }
}
