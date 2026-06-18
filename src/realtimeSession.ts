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
// and the Finnish prompt rides on the agent.
//
// Scope (issue #6): the hosted `web_search` tool is REGISTERED here on the agent
// via `tools: [webSearchTool()]`. It is a hosted MCP tool — it runs remotely on
// OpenAI's side; we own no router, no fetch, and no result handling (STACK.md
// Reject list: "no own tool router/orchestration"). Registration is one line —
// "we add a line, we don't build a subsystem." Non-interruption of speech is the
// already-configured semantic VAD's job, not ours. The spoken-answer behaviour
// is validated live in #8; #6 closes on registration.

import { webSearchTool } from '@openai/agents';
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import { BOB_INSTRUCTIONS, buildSessionConfig } from './sessionConfig.ts';

const MODEL = 'gpt-realtime-2';

/**
 * Build Bob's agent: the Finnish prompt plus the hosted `web_search` tool. Split
 * out from `createRealtimeSession` so a unit test can assert the registered tool
 * on the constructed agent while exercising the real `@openai/agents` import
 * path — if the SDK ever moves `webSearchTool` or its `zod` peer fails to
 * resolve, `verify` turns RED here. `webSearchTool()` takes its defaults (no
 * `searchContextSize` / `filters` / `userLocation`): tuning is a later additive
 * knob, not part of registration.
 */
export function createBobAgent(): RealtimeAgent {
  return new RealtimeAgent({
    name: 'Bob',
    instructions: BOB_INSTRUCTIONS,
    tools: [webSearchTool()],
  });
}

/**
 * Build a fresh RealtimeSession for Bob. The caller drives its lifecycle via
 * `connect({ apiKey })` / `close()` (see `createSessionController`). The config
 * is sent once on connect by the SDK — we never call `session.update`.
 */
export function createRealtimeSession(): RealtimeSession {
  return new RealtimeSession(createBobAgent(), { model: MODEL, config: buildSessionConfig() });
}
