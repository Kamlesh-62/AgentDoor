# AgentDoor

A local middleman CLI that sits in front of terminal-based coding agent
CLIs - `claude` and `codex` out of the box, and any other CLI-based agent
(Grok Build, or anything else) you add to `config/agents.yaml`, no code
required for most of them. You talk to AgentDoor; it decides which agent,
which model, and how much effort to use for each prompt, then shells out
to whichever CLI it picked - using each CLI's own login/session, never a
raw API key.

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
npm install -g @kamlesh-62/agentdoor
```

That gives you the `agentdoor` command from anywhere. First run copies the
default config (`modes.yaml`, `agents.yaml`, `corpus.yaml`, `pricing.yaml`)
into `~/.agentdoor/config` - edit it there; edits survive reinstalls/updates
(a later update never overwrites a file you already have - see
"Configuration" below). Session state and the usage log live alongside it in
`~/.agentdoor/data`.

Working on AgentDoor itself instead? Clone the repo and use:

```
npm install
npm run dev -- "why is this database query timing out"   # reads/writes ./config and ./data directly
npm run build && npm start                                # smoke-tests the real ~/.agentdoor path, as a real install would
```

## Run

```
agentdoor
```

This drops you into a REPL - type prompts like a chat, no need to re-run
the command per prompt. `/exit` to quit (prints a cost/token summary).

The prompt itself shows what's currently active, e.g. `○ frontend codex/gpt-6-astra ›`
- the dot is hollow when the mode is read-only, filled red when it can run
  commands or edit files (see "Tool permissions" below)
- also available anytime via:
- `/status` - active mode, both agents' session ids, cost so far this session
- `/modes` - every configured mode and its agent/model/effort/permissions
- **Tab** - cycle through configured modes (whatever you've typed so far is kept)
- **Shift+Tab** - cycle through models valid for the current agent
- **Ctrl+X** - clear whatever you've typed so far, in one keystroke
- end a line with **`\`** - keep writing on the next line instead of
  submitting (terminals can't reliably tell Enter and Shift+Enter apart,
  so this is the portable equivalent - same convention a shell uses)
- a long paste collapses to a placeholder (`«pasted N chars»`); paste
  again to reveal the real text - it's always what gets sent, never the
  placeholder

Both keys are just quick shortcuts for `/mode <name>` and `!model=<name>` -
same routing underneath, nothing new to learn. They only work in a real
terminal (no-op on piped input).

Or one-shot (single prompt, prints result, exits):

```
agentdoor "why is this database query timing out"
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
3. **LLM escalation** - fires in two cases, not just one: when the semantic
   match is ambiguous AND there's no sticky mode to fall back on, *or*
   when a confident match is about to switch into a mode flagged
   `expensive: true` in `modes.yaml` (e.g. `planning`: opus/high) -
   confident isn't the same as correct, and being confidently wrong about
   an expensive mode is exactly the costly failure mode this exists to
   catch. Continuing in an already-active expensive mode skips this (no
   re-confirmation every turn); switching into one from elsewhere doesn't.
   A cheap `claude -p` call (haiku) makes the judgment call either way -
   real, billed, tracked as an internal entry.
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
whole tool. Ctrl+C while idle warns and arms a 2-second window - only a
second Ctrl+C within that window actually exits, so one accidental press
doesn't lose your session.

## Configuration

Lives in `~/.agentdoor/config` (seeded on first run from the package's
defaults - see "Install"). Running from a repo checkout via `npm run dev`
reads/writes the repo's own `./config` instead, so editing it there takes
effect immediately without touching `~/.agentdoor`.

- `modes.yaml` - named presets: `{agent, model, effort, readOnly,
  expensive}` per mode, plus which mode is the default. Richly commented
  with when-to-use-which-model guidance (Anthropic's own published Sonnet/
  Opus/Haiku guidance, summarized inline) - read it before adding a mode.
- `agents.yaml` - which agents exist: `claude`/`codex` (real
  classes) plus anything under `generic:` (config-only, see "Adding a new
  agent"). This is the actual "add any model" surface.
- `corpus.yaml` - example utterances per mode, used for semantic
  routing. Add more real examples over time; no keywords/regex needed.
- `pricing.yaml` - approximate $/1M token rates, used to estimate
  cost when an agent doesn't report it directly (Codex doesn't; Claude does).

A package update ships new defaults but never overwrites a file you've
already customized; to pick up a changed default, delete that one file from
`~/.agentdoor/config` and it's reseeded on next run.

## What gets persisted (in `~/.agentdoor/data`)

- `sessions.json` - `{claude: sessionId, codex: sessionId}`, so returning to
  an agent resumes its own native conversation memory.
- `state.json` - the current sticky mode + a short rolling window of recent
  prompts, used only to help routing decide, never sent to either agent as
  conversation content.
- `usage-log.jsonl` - one line per completed session: turns, tokens, and
  approximate cost per agent/model.

## Adding a new agent

Not a fixed list of three. Two ways in, depending on the CLI's shape:

**Most CLIs - no code, just YAML.** If it's shaped like
`binary [flags] <prompt>`, optionally printing JSON, add it to
`config/agents.yaml` under `generic:`. `GenericCliAgent` drives it purely
from that config: which flag carries the prompt/model/effort/resume,
which flags to add for read-only vs. write mode, and (if it prints JSON)
dot-notation paths to the answer/session-id/cost/token fields. See the
`grok` entry in that file for a real worked example - Grok Build's whole
integration is config, zero TypeScript.

```yaml
generic:
  my-agent:
    binary: my-agent-cli
    promptMode: positional      # or "flag" + promptFlag: "-p"
    modelFlag: "--model"
    effortFlag: "--effort"
    resumeFlag: "--resume"
    extraArgs: ["--json"]
    readOnlyArgs: ["--read-only"]
    writeArgs: []
    fields: { text: answer, sessionId: session_id }
    authCheckArgs: ["auth", "status"]      # optional - see below
    loggedInPattern: "logged in"
    notLoggedInPattern: "not logged in"
```

Then reference it from `config/modes.yaml` like any other agent:
`agent: my-agent`.

**CLIs with a genuinely unusual output format** (streaming JSON events
like claude, JSONL like codex) need a real class: implement `AgentAdapter`
(see `ClaudeAgent.ts`), register it in `index.ts`. Nothing else changes -
Router/Dispatcher only ever depend on the interface.

Two more Open/Closed seams, unrelated to agents:

- **New routing strategy**: implement `ModeResolver`, insert it into the
  chain built in `index.ts`. Nothing else changes.
- **Real neural embeddings instead of TF-IDF**: implement
  `EmbeddingProvider` (see `TfIdfEmbeddingProvider.ts`), swap it in
  `index.ts`. `EmbeddingResolver` never changes.

## Checking whether an agent is actually usable

`/doctor` runs every registered agent's free preflight check (no model
call, ever) and reports what it finds:

```
Agent status:
  ✓ claude     logged in as you@example.com
  ✓ codex      Logged in using ChatGPT
  ✗ grok       grok CLI ("grok") not found on PATH
```

This also runs quietly at startup, but only for agents a configured mode
actually uses - it won't warn about grok being uninstalled if nothing
routes to it. If a dispatch fails partway through for a recognizable
reason (not logged in, usage limit/quota reached), you get that plain
message instead of a raw CLI stack trace - e.g. `⚠ codex is not logged in
- run \`codex login\``. Anything not recognizable still surfaces as a
normal error; this only covers the cases each adapter knows how to name.

Preflight checks used, all free:
- `claude` - `claude auth status` (JSON, `loggedIn` field)
- `codex` - `codex login status` (prints to **stderr**, not stdout)
- `grok` - no confirmed free status command; checks for its credential
  file at `~/.grok/auth.json` instead
- any `generic:` agent - `authCheckArgs` + regex patterns if configured,
  else just confirms the binary resolves

## Known limitations (prototype, by design)

- `codex`'s effort mapping (`-c model_reasoning_effort=<level>`) is an
  assumption about its config schema, isolated to `CodexAgent.ts` - update
  there if a codex version changes this.
- The `grok` entry in `config/agents.yaml` is built from xAI's published
  CLI docs but **not verified against a real install** (grok wasn't
  available in the environment this was built in) - the prompt/effort/
  resume flags are confirmed by docs.x.ai, but the exact JSON field names
  (`fields:` in that config) and the read-only flag are best-effort
  guesses. `GenericCliAgent` degrades gracefully if a field guess is wrong
  (falls back to raw stdout as the answer), but confirm and fix these
  once you've actually run it.
- Forcing `!codex`/`!claude` without also forcing `!model=` reuses the
  current/default mode's model, which may not be a valid model name for
  the agent you just switched to. Pair agent overrides with a model
  override when switching to an agent the active mode wasn't built for.
- No cross-agent context handoff: if a turn goes to Codex, Claude's session
  doesn't know it happened, and vice versa - only same-agent continuity via
  `--resume`, by design (see "Why" above).
