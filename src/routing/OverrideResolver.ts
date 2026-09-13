import type { ModeResolver } from "./ModeResolver.js";
import type { AgentName, Effort, ModesFile, RoutingContext, RoutingDecision } from "../types.js";

interface ParsedOverrides {
  explicitMode?: string;
  agent?: AgentName;
  model?: string;
  effort?: Effort;
  write?: boolean;
  rest: string;
}

const MODEL_OVERRIDE = /^!model[:=]?\s*(\S+)\s*/i;
const EFFORT_OVERRIDE = /^!effort[:=]?\s*(low|medium|high|xhigh|max)\s*/i;
const AGENT_OVERRIDE = /^!(claude|codex)\s*/i;
const MODE_OVERRIDE = /^\/mode\s+(\S+)\s*/i;
const WRITE_OVERRIDE = /^!write\s*/i;

/** Strips leading override tokens (e.g. "/mode backend", "!codex", "!effort high", "!write")
 * from the start of a prompt, applying each as it's found. */
function parseOverrides(raw: string): ParsedOverrides {
  const acc: ParsedOverrides = { rest: raw.trim() };

  let changed = true;
  while (changed) {
    changed = false;

    let m = acc.rest.match(MODE_OVERRIDE);
    if (m) {
      acc.explicitMode = m[1].toLowerCase();
      acc.rest = acc.rest.slice(m[0].length);
      changed = true;
      continue;
    }

    m = acc.rest.match(AGENT_OVERRIDE);
    if (m) {
      acc.agent = m[1].toLowerCase() as AgentName;
      acc.rest = acc.rest.slice(m[0].length);
      changed = true;
      continue;
    }

    m = acc.rest.match(MODEL_OVERRIDE);
    if (m) {
      acc.model = m[1].toLowerCase();
      acc.rest = acc.rest.slice(m[0].length);
      changed = true;
      continue;
    }

    m = acc.rest.match(EFFORT_OVERRIDE);
    if (m) {
      acc.effort = m[1].toLowerCase() as Effort;
      acc.rest = acc.rest.slice(m[0].length);
      changed = true;
      continue;
    }

    m = acc.rest.match(WRITE_OVERRIDE);
    if (m) {
      acc.write = true;
      acc.rest = acc.rest.slice(m[0].length);
      changed = true;
      continue;
    }
  }

  return acc;
}

/**
 * Highest-priority resolver: explicit user intent always wins over any
 * automatic routing. Syntax:
 *   /mode backend   - switch sticky mode, applies to this turn too
 *   !claude / !codex - force the agent for this turn only
 *   !model=opus      - force the model for this turn only
 *   !effort=high     - force the effort for this turn only
 *   !write           - allow this turn to run commands/edit files, even if
 *                       the mode is read-only by default (this turn only,
 *                       does not change the mode's stored config)
 * Returns null (declines) only when the prompt has no override tokens at all.
 */
export class OverrideResolver implements ModeResolver {
  constructor(private readonly modesFile: ModesFile) {}

  async resolve(ctx: RoutingContext): Promise<RoutingDecision | null> {
    const parsed = parseOverrides(ctx.rawPrompt);
    const hasOverride = Boolean(
      parsed.explicitMode || parsed.agent || parsed.model || parsed.effort || parsed.write,
    );
    if (!hasOverride) return null;

    const baseModeName =
      parsed.explicitMode ?? ctx.currentMode ?? this.modesFile.default;
    const baseMode = this.modesFile.modes[baseModeName];
    if (!baseMode) {
      throw new Error(
        `/mode "${baseModeName}" is not defined in modes.yaml. Known modes: ${Object.keys(this.modesFile.modes).join(", ")}`,
      );
    }

    return {
      mode: baseModeName,
      agent: parsed.agent ?? baseMode.agent,
      model: parsed.model ?? baseMode.model,
      effort: parsed.effort ?? baseMode.effort,
      explicitModel: Boolean(parsed.model),
      readOnly: parsed.write ? false : (baseMode.readOnly ?? true),
      source: "override",
      reason: describeOverride(parsed),
      cleanedPrompt: parsed.rest,
    };
  }
}

function describeOverride(parsed: ParsedOverrides): string {
  const parts: string[] = [];
  if (parsed.explicitMode) parts.push(`mode=${parsed.explicitMode}`);
  if (parsed.agent) parts.push(`agent=${parsed.agent}`);
  if (parsed.model) parts.push(`model=${parsed.model}`);
  if (parsed.effort) parts.push(`effort=${parsed.effort}`);
  if (parsed.write) parts.push("write=true");
  return `manual override (${parts.join(", ")})`;
}
