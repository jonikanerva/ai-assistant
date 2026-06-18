import { describe, expect, it } from 'vitest';
import { BOB_INSTRUCTIONS, buildSessionConfig } from './sessionConfig.ts';

describe('buildSessionConfig', () => {
  it('uses OpenAI semantic VAD for turn-taking, with eagerness auto', () => {
    // STACK.md Reject list: semantic VAD owns turns — assert the type and the
    // single tuning knob (#8), nothing else.
    const turnDetection = buildSessionConfig().audio.input.turnDetection;
    expect(turnDetection.type).toBe('semantic_vad');
    expect(turnDetection.eagerness).toBe('auto');
  });

  it('sets a voice at audio.output.voice (placement, not the literal)', () => {
    // The voice literal is a #8 A/B knob, so we assert it is set at the right
    // path — re-pointing the default must NOT break this test.
    const voice = buildSessionConfig().audio.output.voice;
    expect(typeof voice).toBe('string');
    expect(voice.length).toBeGreaterThan(0);
  });
});

describe('BOB_INSTRUCTIONS', () => {
  it('is a non-empty Finnish-language prompt', () => {
    // Assert presence of a Finnish marker, not exact wording, so ux can re-word
    // the prompt without breaking the test.
    expect(BOB_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(BOB_INSTRUCTIONS.toLowerCase()).toContain('suomeksi');
  });
});
