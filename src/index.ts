#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import chalk from "chalk";

import { loadModes } from "./config/loadModes.js";
import { loadCorpus } from "./config/loadCorpus.js";
import { loadPricing } from "./config/loadPricing.js";
import { loadAgents } from "./config/loadAgents.js";

import { ClaudeAgent } from "./agents/ClaudeAgent.js";
import { CodexAgent } from "./agents/CodexAgent.js";
import { GenericCliAgent } from "./agents/GenericCliAgent.js";
import { AgentRegistry } from "./agents/AgentRegistry.js";
import { Dispatcher } from "./agents/Dispatcher.js";

import { TfIdfEmbeddingProvider } from "./embedding/TfIdfEmbeddingProvider.js";

import { OverrideResolver } from "./routing/OverrideResolver.js";
import { EmbeddingResolver } from "./routing/EmbeddingResolver.js";
import { LlmEscalationResolver } from "./routing/LlmEscalationResolver.js";
import { DefaultResolver } from "./routing/DefaultResolver.js";
import { Router } from "./routing/Router.js";

import { SessionStore } from "./session/SessionStore.js";
import { RoutingStateStore } from "./session/RoutingStateStore.js";
import { UsageTracker } from "./usage/UsageTracker.js";

import { startRepl, runTurn } from "./cli/repl.js";
import { runDoctorChecks, renderStartupWarnings } from "./cli/doctor.js";
import { renderSessionSummary } from "./ui/SessionSummary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, ".."); // dist/ or src/ (via tsx) -> project root

// Packaged config (config/*.yaml shipped inside dist/../config) is the
// read-only source of defaults. Actual config + runtime data always live
// under the user's home directory instead of inside the package install
// - required for a global `npm install -g`, where the package directory
// is often unwritable without sudo, gets wiped on every update, and (on
// a shared machine) would otherwise mix every user's session/cost data
// into one file. Same paths whether running from a repo checkout via
// `npm start` or from a real global install - one behavior, no "dev
// mode" special-casing to keep in sync.
const PACKAGED_CONFIG_DIR = join(ROOT, "config");
const USER_DIR = join(homedir(), ".agentdoor");

// AGENTDOOR_CONFIG_DIR / AGENTDOOR_DATA_DIR are an escape hatch, not a
// user-facing feature: `npm run dev` sets AGENTDOOR_CONFIG_DIR to the
// repo's own config/ so editing config/modes.yaml while developing takes
// effect immediately, same as before this change - without it, every run
// would seed-and-then-ignore the repo copy in favor of ~/.agentdoor.
const CONFIG_DIR = process.env.AGENTDOOR_CONFIG_DIR ?? join(USER_DIR, "config");
const DATA_DIR = process.env.AGENTDOOR_DATA_DIR ?? join(USER_DIR, "data");

/** First run (or an update that ships a new default file): copies
 * whatever's missing from the packaged defaults into the user's config
 * dir. Never overwrites a file the user already has - edits in
 * ~/.agentdoor/config survive both restarts and package updates. To pick
 * up a changed packaged default, delete the file in ~/.agentdoor/config
 * and it'll be reseeded on next run. Skipped entirely when
 * AGENTDOOR_CONFIG_DIR points somewhere else - seeding only makes sense
 * for the default user dir. */
function ensureUserConfig(): void {
  if (process.env.AGENTDOOR_CONFIG_DIR) return;
  mkdirSync(CONFIG_DIR, { recursive: true });
  for (const file of readdirSync(PACKAGED_CONFIG_DIR)) {
    const dest = join(CONFIG_DIR, file);
    if (!existsSync(dest)) copyFileSync(join(PACKAGED_CONFIG_DIR, file), dest);
  }
}

async function main() {
  ensureUserConfig();

  const modesFile = loadModes(join(CONFIG_DIR, "modes.yaml"));
  const corpus = loadCorpus(join(CONFIG_DIR, "corpus.yaml"));
  const pricing = loadPricing(join(CONFIG_DIR, "pricing.yaml"));
  const agentsFile = loadAgents(join(CONFIG_DIR, "agents.yaml"));

  // --- Agents ---
  // claude/codex need real classes (their output formats - streaming
  // JSON events, JSONL - are genuinely special). Anything else is wired
  // up purely from config/agents.yaml's `generic:` section via
  // GenericCliAgent - "add a new agent" means editing YAML, not writing
  // TypeScript, for any CLI shaped like "binary [flags] <prompt>".
  const registry = new AgentRegistry();
  registry.register(new ClaudeAgent());
  registry.register(new CodexAgent());
  for (const [name, cfg] of Object.entries(agentsFile.generic ?? {})) {
    registry.register(new GenericCliAgent(name, cfg));
  }

  // --- Persistence ---
  const sessionStore = new SessionStore(join(DATA_DIR, "sessions.json"));
  const stateStore = new RoutingStateStore(join(DATA_DIR, "state.json"));
  const usageTracker = new UsageTracker(pricing, join(DATA_DIR, "usage-log.jsonl"));

  // --- Semantic routing ---
  const embedder = new TfIdfEmbeddingProvider();
  embedder.fit(Object.values(corpus).flat());

  // --- Routing chain (Chain of Responsibility; order = priority) ---
  const router = new Router([
    new OverrideResolver(modesFile),
    new EmbeddingResolver(embedder, corpus, modesFile),
    new LlmEscalationResolver(registry.get("claude"), modesFile, usageTracker),
    new DefaultResolver(modesFile),
  ]);

  const dispatcher = new Dispatcher(registry, sessionStore, process.cwd());

  const deps = { router, dispatcher, usageTracker, stateStore, sessionStore, modesFile, registry };

  // Quiet startup check: only agents actually used by a configured mode,
  // never grok/etc. if nothing references them - silent when nothing's
  // wrong, so this never adds noise on the common path.
  const usedAgentNames = new Set(Object.values(modesFile.modes).map((m) => m.agent));
  const usedAgents = registry.all().filter((a) => usedAgentNames.has(a.name));
  const warnings = renderStartupWarnings(await runDoctorChecks(usedAgents));
  if (warnings) console.error(warnings + "\n");

  const argPrompt = process.argv.slice(2).join(" ").trim();
  if (argPrompt) {
    // One-shot mode: `agentdoor "some prompt"`
    await runTurn(argPrompt, deps);
    console.log("\n" + renderSessionSummary(usageTracker.persistSessionSummary()));
    return;
  }

  await startRepl(deps);
}

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${(err as Error).message}`));
  process.exit(1);
});
