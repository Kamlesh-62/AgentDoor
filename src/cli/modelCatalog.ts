import type { AgentName, ModesFile } from "../types.js";

/**
 * Unique models configured for a given agent, in the order they first
 * appear across modes.yaml - used for Shift+Tab cycling. Derived from the
 * existing mode config rather than a separate catalog file, so there's
 * one source of truth for "which models exist" per agent.
 */
export function getModelsForAgent(modesFile: ModesFile, agent: AgentName): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const cfg of Object.values(modesFile.modes)) {
    if (cfg.agent === agent && !seen.has(cfg.model)) {
      seen.add(cfg.model);
      models.push(cfg.model);
    }
  }
  return models;
}

/** Returns the model that comes after `current` in the agent's list,
 * wrapping around. If `current` isn't in the list (or the list is empty),
 * returns the list's first model, or null if there are none. */
export function nextModel(models: string[], current: string | null): string | null {
  if (models.length === 0) return null;
  const index = current ? models.indexOf(current) : -1;
  return models[(index + 1) % models.length];
}

/** Returns the mode name that comes after `current` in modesFile's
 * insertion order, wrapping around. */
export function nextMode(modesFile: ModesFile, current: string | null): string {
  const names = Object.keys(modesFile.modes);
  const index = current ? names.indexOf(current) : -1;
  return names[(index + 1) % names.length];
}
