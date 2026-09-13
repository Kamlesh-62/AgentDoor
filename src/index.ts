#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import chalk from "chalk";

import { loadModes } from "./config/loadModes.js";
import { loadCorpus } from "./config/loadCorpus.js";
import { loadPricing } from "./config/loadPricing.js";

import { ClaudeAgent } from "./agents/ClaudeAgent.js";
import { CodexAgent } from "./agents/CodexAgent.js";
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
import { renderSessionSummary } from "./ui/SessionSummary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, ".."); // dist/ or src/ (via tsx) -> project root
const CONFIG_DIR = join(ROOT, "config");
const DATA_DIR = join(ROOT, "data");

async function main() {
  const modesFile = loadModes(join(CONFIG_DIR, "modes.yaml"));
  const corpus = loadCorpus(join(CONFIG_DIR, "corpus.yaml"));
  const pricing = loadPricing(join(CONFIG_DIR, "pricing.yaml"));

  // --- Agents (Open/Closed extension point: add a class + register it) ---
  const registry = new AgentRegistry();
  registry.register(new ClaudeAgent());
  registry.register(new CodexAgent());

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

  const deps = { router, dispatcher, usageTracker, stateStore, sessionStore, modesFile };

  const argPrompt = process.argv.slice(2).join(" ").trim();
  if (argPrompt) {
    // One-shot mode: `agent-router "some prompt"`
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
