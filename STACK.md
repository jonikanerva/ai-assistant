# Bob — Technical Architecture & Decisions

> Updated: 2026-06-18 · Status: design phase, not yet implemented
> Product vision: [VISION.md](VISION.md)

## Core choice: realtime speech-to-speech

The goal is the ChatGPT voice mode experience (see VISION.md), so we chose a
**realtime speech-to-speech** model rather than a chained STT → LLM → TTS
pipeline.

- **A) Realtime speech-to-speech** _(chosen)_ — a single model listens and
  speaks. Most natural turn-taking, barge-in, lowest latency. Matches the "voice
  mode" feel.
- **B) Chained pipeline** _(fallback)_ — separate STT/LLM/TTS. Would allow a free
  choice of voice (e.g. ElevenLabs Finnish), but worse turn-taking and latency.
  Adopted only if the realtime voice's Finnish isn't good enough.

**GPT-Realtime-2**, released in May 2026, brought GPT-5-class reasoning and
configurable reasoning effort directly into the realtime session. A separate
"thinking" pipeline is therefore unnecessary: hard math and reasoning are handled
in the model.

## Locked-in choices

| Area                  | Choice                                                      |
| --------------------- | ----------------------------------------------------------- |
| Language              | TypeScript                                                  |
| SDK                   | OpenAI Agents SDK — `RealtimeSession`                       |
| Model                 | GPT-Realtime-2 (speech-to-speech)                           |
| Transport             | WebRTC (browser)                                            |
| Connection / security | Short-lived **ephemeral token**, minted by a local process  |
| Key                   | OpenAI API key kept locally at first (never in the browser) |
| Tools                 | Hosted **web_search** (MCP)                                 |
| Math                  | Model reasoning effort (no custom calculator)               |
| Turn-taking           | OpenAI semantic VAD (not our own)                           |

## Engineering baseline

| Area                | Choice                                            | Owner      |
| ------------------- | ------------------------------------------------- | ---------- |
| Language            | TypeScript, `strict` mode                         | user-owned |
| Runtime             | Node 24 LTS                                        | user-owned |
| Toolchain manager   | mise (`mise install` provisions the dev env)      | stack      |
| Package manager     | pnpm                                              | stack      |
| Lint + format       | Biome (one tool; `biome ci` inside verify)        | stack      |
| Test runner         | Vitest                                            | stack      |
| Bundler / dev server| Vite (static page build + dev server)             | stack      |

> Language, runtime version, and `strict` are **user-owned** and changed only by the
> user. Everything else in this section is stack-owned.

### Build & verify commands

`$VERIFY_CMD = npm run verify` — the single gate every PR (and CI) must pass:

| Step      | Command                          | Purpose                       |
| --------- | -------------------------------- | ----------------------------- |
| Typecheck | `tsc --noEmit`                   | TS strict, no type errors     |
| Lint+fmt  | `biome ci .`                     | format + lint + import order  |
| Test      | `vitest run --passWithNoTests`   | unit tests (Vitest)           |

Dev env: `mise install` (installs Node + pnpm, then `pnpm install` via the postinstall hook).
`dev` / `build` scripts arrive with the MVP-0 implementation (they depend on the
page's bundler). Running `verify` **locally** is the mandatory and sufficient quality
gate — there is no CI.

### The token process (`pnpm run token`)

The local ephemeral-token endpoint runs as a **separate process**, not as part of
`verify` (which must stay keyless-green and never needs a real key):

| Aspect      | Detail                                                        |
| ----------- | ------------------------------------------------------------ |
| Script      | `pnpm run token` → `node --env-file=.env server/token.ts`    |
| Key source  | `OPENAI_API_KEY` from `.env` (gitignored); fail-fast if unset |
| Bind        | `127.0.0.1:8787` (localhost only, never `0.0.0.0`)           |
| Endpoint    | `POST /token` → mints and returns `{ "value": "ek_..." }`    |
| Code        | `server/token.ts` (I/O shell) + `server/mintToken.ts` (pure) |

The key lives only in this process — it is never logged and never reaches the
browser. The endpoint takes no client input (the model is server-fixed) and leaks
no upstream detail on error (`502 {"error":"token_mint_failed"}`).

The **browser wiring** that consumes this endpoint was the question issue #3
deferred to #4. **Decision (issue #4): a same-origin Vite dev-server proxy, not
CORS.** `vite.config.ts` proxies `/token` → `http://127.0.0.1:8787`, so the page
POSTs to a same-origin `/token`. We chose this over enabling CORS on the token
process because it keeps the token server's HTTP surface unchanged (no CORS
headers, no preflight, no cross-origin credential surface) and the browser code
needs zero base-URL configuration — the smallest, most additive option
(CLAUDE.md §2). The endpoint itself stays proven by direct localhost HTTP plus
unit tests.

### Approved dependencies

Default is **zero** runtime dependencies beyond these; adding one requires the
CLAUDE.md dependency rule (can't be delegated to the platform + recorded in the PR).

- **Runtime:** `@openai/agents` (the Agents SDK; `RealtimeSession` via
  `@openai/agents/realtime`), pinned at `^0.11.7` (added in issue #4). The token
  process uses Node built-ins only (`node:http`) — no web framework for ~20 lines.
- **Dev / toolchain:** `typescript`, `@biomejs/biome`, `vitest`, `@types/node`, `vite`.

Anything on the Reject list (our own VAD, audio buffering, tool router, memory/DB,
custom TTS) is **not** an approved dependency. See the Reject list below.

### Persistence shape

**None.** MVP-0 is stateless: no database, no on-disk conversation store. Session
state lives inside the OpenAI Realtime session and is gone when it closes (VISION.md
non-goal: not our own conversation-memory or database layer). The only local secret
is `OPENAI_API_KEY` in `.env` (gitignored), read by the token process. Cross-session
memory, if ever needed, is a hosted memory MCP — never our own DB.

### Performance budgets

| Budget                  | Target                                              |
| ----------------------- | --------------------------------------------------- |
| Spoken response latency | sub-second to first audio (network not the limit)   |
| Token-mint endpoint     | < 200 ms locally                                    |
| Idle timeout            | closes the session to cap audio-minute cost         |
| Barge-in                | handled by the platform (semantic VAD), not by us   |

These are validation targets for MVP-0 (see Risks & validation).

## Thin-client principle and the "thin waist"

The heart of the design: minimize our own logic, maximize what OpenAI handles.
The more of the right-hand column, the less code we own and the more we get for
free as the platform evolves.

| We own (unavoidable)                      | OpenAI owns (we lean on this)                |
| ----------------------------------------- | -------------------------------------------- |
| Audio device binding / defaults           | Speech-to-text (STT)                         |
| Session open/close (button, idle timeout) | Turn-taking / end-of-turn (semantic VAD)     |
| Ephemeral token minting (~20 lines)       | Interruption / barge-in                      |
| Session configuration (declarative)       | Reasoning (reasoning effort)                 |
|                                           | Speech synthesis, Finnish voice & prosody    |
|                                           | Conversation state within the session        |
|                                           | Tool orchestration + web_search (hosted MCP) |
|                                           | Connection protocol (via the SDK)            |

**The thin waist = the session configuration.** The only thing we truly define is
a declarative configuration (model, voice, Finnish-language instructions,
`turn_detection`, `tools[]`). When OpenAI ships a new feature, it shows up as a
new config field or a hosted tool — **we add a line, we don't build a
subsystem.**

## Architecture

### Target state (north star)

```
HOME BOX (Mac mini / Linux NUC / Pi 5)
┌──────────────────────────────────────────────────┐
│ Jabra Speak (USB) — HW echo cancellation         │
│ Wake word (Porcupine / openWakeWord)  ← always-on│
│   "Hei Bob" → connect()                          │
│ Kiosk Chromium → static page                     │
│   • RealtimeSession (WebRTC)                     │
│   • getUserMedia → Jabra, output → Jabra         │
│ Local process: key + ephemeral token             │
└──────────────────┬───────────────────────────────┘
                   │ token + WebRTC (audio)
                   ▼
   OpenAI Realtime API — GPT-Realtime-2
   • semantic VAD, barge-in, STT, TTS (Finnish)
   • reasoning effort · hosted web_search (MCP)
```

### MVP-0 (current scope — see below)

```
MacBook (normal browser, manual start)
┌─────────────────────────────────────────────────┐
│ (1) Local process (~20 lines, Node)             │
│     • serves the localhost page                 │
│     • holds the API key                         │
│     • mints the ephemeral token                 │
│ (2) Normal browser → localhost                  │
│     • "Talk" button (toggle)                    │
│     • RealtimeSession (WebRTC)                  │
│     • MacBook built-in mic + speaker            │
│       (browser's own AEC handles echo)          │
└──────────────────┬──────────────────────────────┘
                   │ ephemeral token + WebRTC (audio)
                   ▼
   OpenAI Realtime API — GPT-Realtime-2 · web_search
```

### Control flow

1. Startup → the browser opens the localhost page → the page fetches the
   ephemeral token from the local process.
2. Idle: WebRTC closed, mic inert.
3. **"Talk" button** → `connect()` (the button press also serves as the user
   gesture the browser requires to start audio).
4. Continuous conversation: semantic VAD handles turns, barge-in allowed;
   `web_search` runs remotely and does not interrupt speech.
5. Button again or idle timeout → `close()` → back to idle.

## Runtime decision: C2 (browser) vs C1 (Node daemon)

The SDK supports the transports `OpenAIRealtimeWebRTC`, `OpenAIRealtimeWebSocket`,
and `OpenAIRealtimeSIP`.

- **C2 — browser (chosen).** The browser owns the mic, speaker, echo
  cancellation, and WebRTC → least code of our own and the best barge-in/echo
  result. It is also OpenAI's most mature, most actively developed path → the
  most "free" improvements.
- **C1 — Node daemon.** Justified only if we want to use the Jabra's own physical
  button (`node-hid` reads HID call control) and its LED status feedback. Cost:
  our own audio pipe (PCM in/out) and echo cancellation resting on the hardware.

## MVP-0 (current scope)

The thinnest possible spike that validates the core risk with the least code:

- Runs **on a personal MacBook**, in a **normal browser**, started **manually**
  (`npm run dev` → open a tab → "Talk").
- MacBook's **built-in mic + speaker**; the browser's own `echoCancellation`
  handles echo.
- **No** Jabra, **no** kiosk mode, **no** always-on/daemon, **no** wake word.
- Contents: ~20-line token process + one page + hosted `web_search`, a
  Finnish-language system prompt, toggle + idle timeout.

In practice the whole implementation is **one Node file + one page.**

> Note: the ephemeral-token process is not an optional "ops" layer but OpenAI's
> required way to open a browser WebRTC connection — the browser connects with a
> short-lived token, not the raw API key.

## Phasing principle

> The **backlog and roadmap live in GitHub Issues + Milestones**, not in this repo
> (CLAUDE.md → Git workflow). Milestones = phases; issues = the work, labelled by
> phase and area. What belongs *here* is only the sequencing rule — that's
> architecture, not backlog:

1. **MVP-0** validates the core risk first — natural Finnish + free conversation +
   `web_search` — as a laptop browser spike, before any hardware.
2. **MVP-1** adds a physical "talk" button (USB keypress; or Jabra HID if C1).
3. **MVP-2** adds the home box: Jabra Speak + kiosk Chromium + always-on + wake
   word "Hei Bob".
4. **Later** — reasoning delegation, hosted cross-session memory, home automation —
   all *as tools*, never as our own subsystems.

Every phase is **additive**: a new capability attaches to the same `connect()` and
touches nothing else. Validate the risk before adding hardware or "always on."

## Scope-out (and why)

- **Wake word out of the MVP** — it will certainly work but is fiddly (Porcupine
  has no native Finnish → use the English phrase "Hey Bob" or openWakeWord); it's
  additive and not part of validating the risk.
- **"Thinking" delegation out** — GPT-Realtime-2's reasoning effort is enough at
  first; add it only if a gap shows up.
- **No custom calculator** — trust the model's reasoning; if numeric accuracy
  fails, add a hosted code-exec MCP (still not our own code).
- **No custom memory/database layer** — if cross-session memory is needed, it's a
  hosted memory MCP, not our own DB.
- **Always-on / daemon / kiosk only in the target phase** — it doesn't speed up
  validating the risk.
- **Jabra device binding only when the hardware enters** (MVP-2).

## Reject list (pattern-level prohibitions)

These violate the thin-client principle — do not build:

- ❌ Our own VAD / turn detection → use OpenAI's semantic VAD.
- ❌ Our own audio buffering/resampling in the browser → getUserMedia + WebRTC
  handle it.
- ❌ Raw API key in the browser → **always** an ephemeral token.
- ❌ Our own tool router/orchestration → function calling + hosted MCP handle it.
- ❌ Our own conversation memory before the need is proven.
- ❌ Locking into a custom TTS voice if the realtime voice is good enough.
- ❌ Multi-user/scaling optimization — this is a personal device.
- ❌ Building the chained pipeline (B) before the realtime Finnish is found
  insufficient.

## Risks & validation

In priority order, validated in MVP-0:

1. **Naturalness of the realtime voice's Finnish** — _the biggest open risk._
   Fallback: chained pipeline (B) + ElevenLabs Finnish.
2. **Latency** — response in the sub-second range (the network isn't the
   bottleneck on gigabit).
3. **web_search in speech** — does it work, and how fast.
4. **Cost** — billed by audio minutes; the idle timeout is the main control.
5. **Browser quirks** — Chromium is smoothest for WebRTC; Safari may have
   autoplay/audio quirks.

> **Note:** the laptop spike validates the OpenAI side and the conversational
> feel, **but not the final room/hardware acoustics.** Echo and barge-in with the
> Jabra in a room are a separate question and return in MVP-2. Don't read a clean
> laptop result as a promise about the final setup.

## To confirm at implementation time (from the docs)

This architecture was designed with information available in June 2026. Before
implementation, confirm the up-to-date details from OpenAI's documentation:

- ✅ The exact realtime-session configuration fields and `turn_detection`
  settings — confirmed (issue #5) against the pinned `@openai/agents` `^0.11.7`
  types (`@openai/agents-realtime@0.11.7`) + OpenAI's semantic-VAD docs. The
  config is declarative on the `RealtimeSession` constructor
  (`new RealtimeSession(agent, { model, config })`, sent once on connect — no
  `session.update`): `config.audio.input.turnDetection = { type: 'semantic_vad', eagerness }`
  and `config.audio.output.voice`; the system prompt rides on the agent
  (`new RealtimeAgent({ name, instructions })`). **Spoken language is controlled
  by `instructions`, not by the voice.** Voice = `marin` (OpenAI's newest
  recommended voice; `cedar` is the #8 A/B alternative); turn-taking
  `eagerness = 'auto'` is the #8 tuning knob. We set ONLY `type` + `eagerness` on
  `turnDetection` (Reject list: semantic VAD owns turns — no threshold /
  create_response / interrupt_response). Verified against the types but NOT
  against a live session; naturalness / turn-feel is validated live in #8.
- ✅ Wiring the `web_search` / hosted MCP tool into the realtime session —
  confirmed (issue #6) against the pinned `@openai/agents` `^0.11.7`: import
  `webSearchTool` from the `@openai/agents` **root** (re-exported from
  `@openai/agents-openai`; it is NOT on the `/realtime` subpath) and register it
  on the agent via `tools: [webSearchTool()]`. It returns a `hosted_tool` named
  `web_search` and runs **server-side** — OpenAI orchestrates and executes it, so
  we own no router, no fetch, and no result handling (Reject list). Called with
  **no options** (defaults; `searchContextSize` / `filters` / `userLocation` are a
  later additive tuning knob). **No new dependency:** `zod` is a transitive peer of
  `@openai/agents`, already locked in `pnpm-lock.yaml` — not pinned in
  `package.json`, on purpose (zero-dep doctrine). Non-interruption of speech is
  handled by the already-configured semantic VAD, not by us. Verified against the
  installed types/SDK; the spoken-answer behaviour is validated live in #8.
- ✅ The browser RealtimeSession connect API — confirmed (issue #4) against the
  Agents SDK (`@openai/agents` `^0.11.7`): import `RealtimeAgent` and
  `RealtimeSession` from the `@openai/agents/realtime` subpath; build
  `new RealtimeAgent({ name })` + `new RealtimeSession(agent, { model })` and
  `await session.connect({ apiKey: ek })`; in a browser the SDK auto-selects the
  **WebRTC** transport (pass none) and auto-configures mic capture + audio
  playback, and `session.close()` stops the sender tracks so the mic goes inert.
  `connect()` opens the data channel, sends the initial config, and waits for the
  `session.updated` ack (with a timeout fallback), so it can take up to ~5s.
- ✅ The exact form of the ephemeral-token endpoint (client secret flow) —
  confirmed (issue #3): `POST https://api.openai.com/v1/realtime/client_secrets`,
  body `{ session: { type: 'realtime', model } }`, the secret comes back as an
  `ek_...` string. The exact field path was **not** live-verified, so the minter
  reads it defensively from either a top-level `value` or a nested
  `client_secret.value` (`server/mintToken.ts`); re-pin to the real shape once a
  live response is captured.
- GPT-Realtime-2's reasoning-effort parameter.

## Sources

- [Introducing gpt-realtime — OpenAI](https://openai.com/index/introducing-gpt-realtime/)
- [Advancing voice intelligence with new models in the API — OpenAI](https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/)
- [Realtime and audio — OpenAI API guide](https://developers.openai.com/api/docs/guides/realtime)
- [GPT-Realtime-2 model — OpenAI API](https://developers.openai.com/api/docs/models/gpt-realtime-2)
- [Voice agents — OpenAI API guide](https://developers.openai.com/api/docs/guides/voice-agents)
- [Building Voice Agents — OpenAI Agents SDK (JS)](https://openai.github.io/openai-agents-js/guides/voice-agents/build/)
- [Porcupine Wake Word — Picovoice](https://picovoice.ai/docs/porcupine/)
- [Finnish Text to Speech — ElevenLabs](https://elevenlabs.io/text-to-speech/finnish)
