# agent-router

A local middleman CLI that sits in front of the `claude` and `codex`
terminal CLIs. You talk to `agent-router`; it decides which agent, which
model, and how much effort to use for each prompt, then shells out to
whichever CLI it picked - using each CLI's own login/session, never a raw
API key.

## Why

- **No API keys.** Every call goes through `claude -p ...` or
  `codex exec ...` as a subprocess, using your existing CLI logins.
- **No custom context store.** Each agent keeps its own native session
  memory (`--resume` for claude, `exec resume` for codex). This tool only
  remembers *which* session id belongs to which agent - never conversation
  content.
- **Smart, not keyword-based, routing.** Prompts are matched to modes by
  TF-IDF cosine similarity against example utterances, not regex/keyword
  rules, with an LLM escalation fallback for genuinely ambiguous cases.

## Install

```
npm install
npm run build
```

## Run

```
npm start
```

This drops you into a REPL - type prompts like a chat, no need to re-run
the command per prompt. `/exit` to quit (prints a cost/token summary).

Or one-shot (single prompt, prints result, exits):

```
npm start -- "why is this database query timing out"
```

Or, after `npm link`, as a plain global command from anywhere:

```
agent-router
agent-router "why is this database query timing out"
```

## How routing works

Every prompt goes through a chain, first confident answer wins:

1. **Manual override** - always wins:
   - `/mode backend` - switch the sticky mode (persists across turns/restarts)
   - `!claude` / `!codex` - force the agent for this turn only
   - `!model=opus` - force the model for this turn only
   - `!effort=high` - force the effort for this turn only
   - `!write` - allow this turn to run commands/edit files (see "Tool
     permissions" below); doesn't change the mode's stored config
   - These combine: `!codex !effort=high fix the flaky test`
2. **Semantic (embedding) match** - the prompt (plus a few recent prompts
   for context) is compared via cosine similarity to each mode's example
   utterances in `config/corpus.yaml`. Confident match -> route there.
   Ambiguous, but you're already in a mode -> stay there (hysteresis, no
   flip-flopping on a single ambiguous message). Sticky mode expires after
   30 minutes of inactivity (configurable in `RoutingStateStore`), so an
   old manual `/mode` override from a previous session can't silently
   misroute an unrelated prompt much later.
3. **LLM escalation** - only when ambiguous AND there's no sticky mode to
   fall back on: a cheap `claude -p` call (haiku) makes the judgment call.
   This is a real, billed call and its cost is tracked as an internal entry.
4. **Default mode** - `modes.yaml`'s `default:` key, if nothing else matched.

## Tool permissions

No human is available to approve a permission prompt when an agent runs
headlessly, so every mode is **read-only by default** (Claude gets
`--restricted`, stripping Bash/Edit/Write; Codex gets `--sandbox
read-only`) - they can look at things but can't run commands or change
files. To let a specific mode make real changes, set `readOnly: false` on
it in `config/modes.yaml`; to allow it for one turn only without changing
the mode, prefix the prompt with `!write`.

## Cancelling a turn

Ctrl+C while a turn is running cancels just that turn (kills the
subprocess, prints a notice, stays in the REPL) instead of exiting the
whole tool. Ctrl+C again while idle exits normally - same as cancelling a
foreground job vs. quitting a shell.

## Configuration

- `config/modes.yaml` - named presets: `{agent, model, effort}` per mode,
  plus which mode is the default.
- `config/corpus.yaml` - example utterances per mode, used for semantic
  routing. Add more real examples over time; no keywords/regex needed.
- `config/pricing.yaml` - approximate $/1M token rates, used to estimate
  cost when an agent doesn't report it directly (Codex doesn't; Claude does).

## What gets persisted (in `data/`, gitignored)

- `sessions.json` - `{claude: sessionId, codex: sessionId}`, so returning to
  an agent resumes its own native conversation memory.
- `state.json` - the current sticky mode + a short rolling window of recent
  prompts, used only to help routing decide, never sent to either agent as
  conversation content.
- `usage-log.jsonl` - one line per completed session: turns, tokens, and
  approximate cost per agent/model.

## Extending

The codebase is deliberately Open/Closed at three seams:

- **New backend agent**: implement `AgentAdapter` (see `ClaudeAgent.ts`),
  register it in `index.ts`. Nothing else changes.
- **New routing strategy**: implement `ModeResolver`, insert it into the
  chain built in `index.ts`. Nothing else changes.
- **Real neural embeddings instead of TF-IDF**: implement
  `EmbeddingProvider` (see `TfIdfEmbeddingProvider.ts`), swap it in
  `index.ts`. `EmbeddingResolver` never changes.

## Known limitations (prototype, by design)

- `codex`'s effort mapping (`-c model_reasoning_effort=<level>`) is an
  assumption about its config schema, isolated to `CodexAgent.ts` - update
  there if a codex version changes this.
- Forcing `!codex`/`!claude` without also forcing `!model=` reuses the
  current/default mode's model, which may not be a valid model name for
  the agent you just switched to. Pair agent overrides with a model
  override when switching to an agent the active mode wasn't built for.
- No cross-agent context handoff: if a turn goes to Codex, Claude's session
  doesn't know it happened, and vice versa - only same-agent continuity via
  `--resume`, by design (see "Why" above).
