// Bob's declarative session configuration — the "thin waist" (STACK.md).
//
// This is the ONE place that holds what Bob *is*: a Finnish system prompt, a
// Finnish-capable voice, and OpenAI semantic VAD for turn-taking. It is pure,
// declarative config that layers onto `realtimeSession.ts` via the
// `RealtimeSession` constructor — "we add a line, we don't build a subsystem"
// (STACK.md "the thin waist = the session configuration").
//
// We own NO turn detection of our own (STACK.md Reject list): semantic VAD owns
// turns, so the `turnDetection` literal carries ONLY `type` + `eagerness` and
// nothing else (no threshold / create_response / interrupt_response).

import type { RealtimeSessionConfig } from '@openai/agents/realtime';

/**
 * Bob's Finnish system prompt. Spoken language is controlled here, NOT by the
 * voice (the voice only renders whatever language the model produces). Kept
 * deliberately short and voice-shaped: this is read aloud, so no markdown,
 * lists, headings, or emoji, and no filler preamble.
 *
 * Out of scope on purpose: cross-turn memory / personalization (VISION.md
 * non-goal), any custom turn / end-of-turn logic (semantic VAD owns turns), and
 * persona backstory / jokes / mood (keep it tight).
 */
export const BOB_INSTRUCTIONS = `Olet Bob, rauhallinen ja ystävällinen kotiavustaja.
Olet huomaamaton etkä jaarittele. Älä aloita täytefraaseilla.
Vastaa suomeksi oletuksena.
Älä päättele kieltä aksentista; vaihda kieltä vain jos käyttäjä selvästi pyytää.
Puhu kuin keskustelussa: 1–3 lyhyttä virkettä per vuoro.
Sinua puhutaan ääneen, joten älä käytä markdownia, listoja, otsikoita tai emojeja.
Älä käytä "anna kun mietin" -tyyppistä täytettä.
Käyttäjä saa keskeyttää sinut, tarkentaa ja vaihtaa aihetta milloin tahansa.
Käytä web_searchia tuoreeseen tietoon ja kerro tulos luonnollisesti puheessa.
Älä keksi tietoa; jos et tiedä, sano se lyhyesti.`;

/**
 * Bob's default voice. Spoken language is set by `BOB_INSTRUCTIONS`, not by the
 * voice — this is purely the rendered timbre. `marin` is OpenAI's newest
 * recommended voice; `cedar` is the #8 A/B alternative. This is a
 * #8-falsifiable default for the project's #1 risk (Finnish naturalness), which
 * is validated live in #8 — so tests assert placement, not this literal.
 */
export const BOB_VOICE = 'marin';

/**
 * Build the declarative session config handed to `new RealtimeSession(agent,
 * { model, config })`. It is sent once on connect; we never call
 * `session.update` and the session state machine is untouched (issue #5 scope).
 *
 * `satisfies Partial<RealtimeSessionConfig>` verifies the literal is assignable
 * to the SDK config (the exact type the constructor accepts) without widening,
 * so the concrete shape stays readable here and in the test while the compiler
 * guarantees every field is real — ZERO `as` / `any`, no deep / internal import.
 */
export function buildSessionConfig() {
  return {
    audio: {
      output: { voice: BOB_VOICE },
      input: { turnDetection: { type: 'semantic_vad', eagerness: 'auto' } },
    },
  } satisfies Partial<RealtimeSessionConfig>;
}
