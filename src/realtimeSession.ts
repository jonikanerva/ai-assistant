// The "thin waist": the single place that constructs an OpenAI RealtimeSession.
//
// This is a deliberately bare shell (STACK.md "thin-client principle"). It owns
// no audio, no transport selection, no VAD — the SDK and the browser own all of
// that. In a browser the SDK auto-selects WebRTC and auto-configures mic capture
// and audio playback, so we pass NO transport here.
//
// Scope (issue #4): model only. The Finnish system prompt, voice, and
// `turn_detection` are declarative config that layers onto THIS file in issue
// #5 — that is exactly the "we add a line, we don't build a subsystem" shape
// (STACK.md "the thin waist = the session configuration"). It is not unit-tested
// because it is pure SDK wiring with no logic of our own.

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const MODEL = 'gpt-realtime-2';

/**
 * Build a fresh RealtimeSession for Bob. The caller drives its lifecycle via
 * `connect({ apiKey })` / `close()` (see `createSessionController`).
 */
export function createRealtimeSession(): RealtimeSession {
  const agent = new RealtimeAgent({ name: 'Bob' });
  return new RealtimeSession(agent, { model: MODEL });
}
