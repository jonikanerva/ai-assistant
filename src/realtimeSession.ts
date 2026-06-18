// The "thin waist": the single place that constructs an OpenAI RealtimeSession.
//
// This is a deliberately bare shell (STACK.md "thin-client principle"). It owns
// no audio, no transport selection, no VAD — the SDK and the browser own all of
// that. In a browser the SDK auto-selects WebRTC and auto-configures mic capture
// and audio playback, so we pass NO transport here.
//
// Scope (issue #5): the Finnish system prompt, voice, and `turn_detection` are
// declarative config that layers onto THIS file — exactly the "we add a line,
// we don't build a subsystem" shape (STACK.md "the thin waist = the session
// configuration"). The config (voice + semantic VAD) lives in `sessionConfig.ts`
// and the Finnish prompt rides on the agent; this file stays pure SDK wiring
// with no logic of our own, so it is not unit-tested (sessionConfig.ts is).

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import { BOB_INSTRUCTIONS, buildSessionConfig } from './sessionConfig';

const MODEL = 'gpt-realtime-2';

/**
 * Build a fresh RealtimeSession for Bob. The caller drives its lifecycle via
 * `connect({ apiKey })` / `close()` (see `createSessionController`). The config
 * is sent once on connect by the SDK — we never call `session.update`.
 */
export function createRealtimeSession(): RealtimeSession {
  const agent = new RealtimeAgent({ name: 'Bob', instructions: BOB_INSTRUCTIONS });
  return new RealtimeSession(agent, { model: MODEL, config: buildSessionConfig() });
}
