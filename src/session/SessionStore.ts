import type { AgentName } from "../types.js";
import { JsonFileStore } from "./JsonFileStore.js";

type SessionMap = Partial<Record<AgentName, string>>;

/**
 * Remembers each agent's own session id so a follow-up turn routed to the
 * same agent resumes its native conversation memory (--resume for claude,
 * `exec resume` for codex) instead of starting cold. Deliberately does NOT
 * store any conversation content - only the id each CLI already tracks
 * internally.
 */
export class SessionStore {
  private readonly store: JsonFileStore<SessionMap>;
  private sessions: SessionMap;

  constructor(filePath: string) {
    this.store = new JsonFileStore<SessionMap>(filePath, {});
    this.sessions = this.store.load();
  }

  get(agent: AgentName): string | undefined {
    return this.sessions[agent];
  }

  set(agent: AgentName, sessionId: string | undefined): void {
    if (!sessionId) return;
    this.sessions[agent] = sessionId;
    this.store.save(this.sessions);
  }
}
