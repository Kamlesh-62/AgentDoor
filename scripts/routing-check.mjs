/**
 * Cost-free sanity check for the routing chain: exercises override parsing,
 * embedding-based mode matching, and the default fallback WITHOUT ever
 * calling the real `claude`/`codex` CLIs (LlmEscalationResolver and
 * Dispatcher are intentionally left out). Run after editing config/modes.yaml
 * or config/corpus.yaml to confirm routing still behaves as expected.
 *
 * Usage: npm run build && npm run routing-check
 */
import { loadModes } from "../dist/config/loadModes.js";
import { loadCorpus } from "../dist/config/loadCorpus.js";
import { TfIdfEmbeddingProvider } from "../dist/embedding/TfIdfEmbeddingProvider.js";
import { EmbeddingResolver } from "../dist/routing/EmbeddingResolver.js";
import { OverrideResolver } from "../dist/routing/OverrideResolver.js";
import { DefaultResolver } from "../dist/routing/DefaultResolver.js";
import { Router } from "../dist/routing/Router.js";

const modesFile = loadModes(new URL("../config/modes.yaml", import.meta.url).pathname);
const corpus = loadCorpus(new URL("../config/corpus.yaml", import.meta.url).pathname);

const embedder = new TfIdfEmbeddingProvider();
embedder.fit(Object.values(corpus).flat());

const router = new Router([
  new OverrideResolver(modesFile),
  new EmbeddingResolver(embedder, corpus, modesFile),
  new DefaultResolver(modesFile),
]);

const tests = [
  "why is this database query so slow",
  "the button isn't aligned on mobile at all",
  "how should we structure this new microservice architecture",
  "!codex fix the css bug",
  "/mode planning let's think about the roadmap",
  "asdkj random gibberish text zzz",
];

for (const prompt of tests) {
  const decision = await router.resolve({ rawPrompt: prompt, recentPrompts: [], currentMode: null });
  console.log(
    JSON.stringify({
      prompt,
      mode: decision.mode,
      agent: decision.agent,
      model: decision.model,
      source: decision.source,
      confidence: decision.confidence,
      cleanedPrompt: decision.cleanedPrompt,
    }),
  );
}
