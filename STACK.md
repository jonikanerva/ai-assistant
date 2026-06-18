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

## Roadmap (phases)

| Phase     | Contents                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| **MVP-0** | Laptop spike: browser + MacBook mic/speaker + web*search. \_Validates the core experience.*                         |
| **MVP-1** | Physical "talk" button (USB keypress; or Jabra HID if C1).                                                          |
| **MVP-2** | Jabra Speak + kiosk Chromium on the home box + always-on + wake word "Hei Bob".                                     |
| Later     | "Thinking" delegation to gpt-5.4 as a tool · cross-session memory (hosted memory MCP) · home automation (as a tool) |

Every phase is **additive** — e.g. the wake word is a module that calls the same
`connect()`, touching nothing else.

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

- The exact realtime-session configuration fields and `turn_detection` settings.
- Wiring the `web_search` / hosted MCP tool into the realtime session.
- The exact form of the ephemeral-token endpoint (client secret flow).
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
