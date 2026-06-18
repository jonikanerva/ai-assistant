import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ControllableSession,
  createSessionController,
  fetchEphemeralToken,
  IDLE_TIMEOUT_MS,
  type SessionActivityEvent,
  type SessionStatus,
  TokenFetchError,
} from './session.ts';

const EK = 'ek_test_1234567890';

function okTokenResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A fake session whose `connect()` is settled by the test, so we can drive the
 * exact moment connect resolves/rejects relative to a toggle() — the only way
 * to exercise the cancel-during-connecting latch deterministically.
 */
function deferredSession(): {
  session: ControllableSession;
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  resolveConnect: () => void;
  rejectConnect: (error: unknown) => void;
  /** Invoke every listener registered for `event` — simulates a live activity event. */
  fireActivity: (event: SessionActivityEvent) => void;
} {
  let innerResolve = (): void => {};
  let innerReject = (_error: unknown): void => {};
  const connect = vi.fn(
    (_opts: { apiKey: string }) =>
      new Promise<void>((resolve, reject) => {
        innerResolve = resolve;
        innerReject = (error: unknown) => reject(error);
      }),
  );
  const close = vi.fn();

  // The controller subscribes to the typed activity events via on()/off(); we
  // capture the registered listeners so a test can invoke them to simulate Bob
  // emitting an activity event (the real SDK fires these from the transport).
  const listeners = new Map<SessionActivityEvent, Set<() => void>>();
  const on = vi.fn((event: SessionActivityEvent, listener: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    set.add(listener);
    listeners.set(event, set);
  });
  const off = vi.fn((event: SessionActivityEvent, listener: () => void) => {
    listeners.get(event)?.delete(listener);
  });

  return {
    session: { connect, close, on, off },
    connect,
    close,
    on,
    off,
    // Delegate through the closures so callers always settle the live promise,
    // not a stale reference captured before connect() ran.
    resolveConnect: () => innerResolve(),
    rejectConnect: (error: unknown) => innerReject(error),
    fireActivity: (event: SessionActivityEvent) => {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
  };
}

const flush = (): Promise<void> => Promise.resolve();

describe('fetchEphemeralToken', () => {
  it('returns the ek_ string on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okTokenResponse({ value: EK }));

    const token = await fetchEphemeralToken(fetchImpl);

    expect(token).toBe(EK);
    expect(fetchImpl).toHaveBeenCalledWith('/token', { method: 'POST' });
  });

  it('throws on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 502 }));

    await expect(fetchEphemeralToken(fetchImpl)).rejects.toBeInstanceOf(TokenFetchError);
  });

  it('throws when the value is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okTokenResponse({ session: { id: 'x' } }));

    await expect(fetchEphemeralToken(fetchImpl)).rejects.toBeInstanceOf(TokenFetchError);
  });

  it('throws when the value is an empty string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okTokenResponse({ value: '' }));

    await expect(fetchEphemeralToken(fetchImpl)).rejects.toBeInstanceOf(TokenFetchError);
  });

  it('throws when the value does not start with ek_', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okTokenResponse({ value: 'sk-not-ephemeral' }));

    await expect(fetchEphemeralToken(fetchImpl)).rejects.toBeInstanceOf(TokenFetchError);
  });

  it('rejects when the network throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(fetchEphemeralToken(fetchImpl)).rejects.toThrow('network down');
  });
});

describe('createSessionController — happy path', () => {
  it('drives idle → connecting → live, then live → idle on the next toggle', async () => {
    const { session, connect, close, resolveConnect } = deferredSession();
    const createSession = vi.fn(() => session);
    const fetchToken = vi.fn().mockResolvedValue(EK);
    const seen: SessionStatus[] = [];

    const controller = createSessionController({ createSession, fetchToken });
    controller.subscribe((s) => seen.push(s));

    controller.toggle();
    expect(controller.getStatus()).toEqual({ phase: 'connecting' });

    await flush(); // fetchToken resolves, createSession + connect called
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ apiKey: EK });

    resolveConnect();
    await flush();
    expect(controller.getStatus()).toEqual({ phase: 'live' });

    controller.toggle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual({ phase: 'idle' });

    expect(seen.map((s) => s.phase)).toEqual(['idle', 'connecting', 'live', 'idle']);
  });
});

describe('createSessionController — cancel during connecting', () => {
  it('closes and lands idle when connect RESOLVES after the cancel toggle (no second connect)', async () => {
    const { session, connect, close, resolveConnect } = deferredSession();
    const createSession = vi.fn(() => session);
    const fetchToken = vi.fn().mockResolvedValue(EK);

    const controller = createSessionController({ createSession, fetchToken });

    controller.toggle(); // → connecting
    await flush(); // connect() now in flight
    controller.toggle(); // cancel while connecting → latch teardown
    expect(controller.getStatus()).toEqual({ phase: 'connecting' });

    resolveConnect();
    await flush();

    expect(close).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
  });

  it('lands idle (not error) when connect REJECTS after the cancel toggle', async () => {
    const { session, connect, close, rejectConnect } = deferredSession();
    const createSession = vi.fn(() => session);
    const fetchToken = vi.fn().mockResolvedValue(EK);

    const controller = createSessionController({ createSession, fetchToken });

    controller.toggle(); // → connecting
    await flush();
    controller.toggle(); // cancel while connecting

    rejectConnect(new Error('connect blew up'));
    await flush();

    expect(connect).toHaveBeenCalledTimes(1);
    // The connect never produced a live session, so there is nothing to close;
    // the user asked to stop, so we end idle rather than error.
    expect(close).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
  });
});

describe('createSessionController — failure paths', () => {
  it('token-fetch rejection → error status, not stuck connecting', async () => {
    const { session } = deferredSession();
    const createSession = vi.fn(() => session);
    const fetchToken = vi.fn().mockRejectedValue(new TokenFetchError('token endpoint down'));

    const controller = createSessionController({ createSession, fetchToken });

    controller.toggle();
    await flush();

    expect(createSession).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ phase: 'error', reason: 'connection-failed' });
  });

  it('connect rejection → connection-failed error status', async () => {
    const { session, rejectConnect } = deferredSession();
    const createSession = vi.fn(() => session);
    const fetchToken = vi.fn().mockResolvedValue(EK);

    const controller = createSessionController({ createSession, fetchToken });

    controller.toggle();
    await flush();
    rejectConnect(new Error('ICE failed'));
    await flush();

    expect(controller.getStatus()).toEqual({ phase: 'error', reason: 'connection-failed' });
  });

  it('recovers from an error status: toggling again starts a fresh connect', async () => {
    const { session, rejectConnect, resolveConnect } = deferredSession();
    const createSession = vi.fn(() => session);
    const fetchToken = vi.fn().mockResolvedValue(EK);

    const controller = createSessionController({ createSession, fetchToken });

    controller.toggle();
    await flush();
    rejectConnect(new Error('ICE failed'));
    await flush();
    expect(controller.getStatus()).toEqual({ phase: 'error', reason: 'connection-failed' });

    controller.toggle(); // from error → connecting again
    expect(controller.getStatus()).toEqual({ phase: 'connecting' });
    await flush();
    resolveConnect();
    await flush();
    expect(controller.getStatus()).toEqual({ phase: 'live' });
    expect(createSession).toHaveBeenCalledTimes(2);
  });
});

describe('createSessionController — mic permission denied', () => {
  it('surfaces a distinct mic-denied status when connect rejects with NotAllowedError', async () => {
    const { session, rejectConnect } = deferredSession();
    const createSession = vi.fn(() => session);
    const fetchToken = vi.fn().mockResolvedValue(EK);

    const controller = createSessionController({ createSession, fetchToken });

    controller.toggle();
    await flush();
    // getUserMedia denial shape: a DOMException-like error named NotAllowedError.
    rejectConnect(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    await flush();

    expect(controller.getStatus()).toEqual({ phase: 'error', reason: 'mic-denied' });
  });
});

describe('createSessionController — idle timeout (issue #7)', () => {
  // Fake timers let us advance the inactivity clock deterministically. Microtasks
  // (the connect promise) still settle with `await flush()`, so we reach `live`
  // BEFORE advancing the clock.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Build a controller and drive it to `live`, returning the fake's handles. */
  async function reachLive(): Promise<{
    controller: ReturnType<typeof createSessionController>;
    fake: ReturnType<typeof deferredSession>;
  }> {
    const fake = deferredSession();
    const createSession = vi.fn(() => fake.session);
    const fetchToken = vi.fn().mockResolvedValue(EK);
    const controller = createSessionController({ createSession, fetchToken });

    controller.toggle();
    await flush(); // fetchToken resolves, connect() called
    fake.resolveConnect();
    await flush(); // → live, listeners subscribed, idle timer armed
    expect(controller.getStatus()).toEqual({ phase: 'live' });
    return { controller, fake };
  }

  it('(a) auto-closes after the inactivity window with no activity', async () => {
    const { controller, fake } = await reachLive();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);

    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
  });

  it('(b) resets the window on an activity event, then fires a full window later', async () => {
    const { controller, fake } = await reachLive();

    // Just before the window elapses, Bob emits an activity event → reset.
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    fake.fireActivity('history_added');

    // The original window's remaining 1ms must NOT close it — the timer re-armed.
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    expect(fake.close).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ phase: 'live' });

    // A further full window from the reset finally closes it.
    vi.advanceTimersByTime(1);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
  });

  it('(b2) each first-class activity event resets the timer', async () => {
    for (const event of ['agent_start', 'audio_stopped', 'history_added'] as const) {
      const { controller, fake } = await reachLive();

      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
      fake.fireActivity(event);
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
      expect(fake.close, `reset on ${event}`).not.toHaveBeenCalled();
      expect(controller.getStatus()).toEqual({ phase: 'live' });

      vi.advanceTimersByTime(1);
      expect(fake.close, `closes after ${event} window`).toHaveBeenCalledTimes(1);
      expect(controller.getStatus()).toEqual({ phase: 'idle' });
    }
  });

  it('(c) manual toggle-off clears the timer and removes listeners — no late fire', async () => {
    const { controller, fake } = await reachLive();

    controller.toggle(); // manual close before the timeout
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
    expect(fake.close).toHaveBeenCalledTimes(1);
    // The three activity listeners are all removed on leaving `live`.
    expect(fake.off).toHaveBeenCalledTimes(3);

    // No timer remains to fire: advancing the clock changes nothing.
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
  });

  it('(c2) a fired activity listener after manual close cannot re-arm the timer', async () => {
    const { controller, fake } = await reachLive();

    // Capture a listener reference, then close manually (which off()s it).
    controller.toggle();
    expect(controller.getStatus()).toEqual({ phase: 'idle' });

    // Even if a stale event somehow reached a removed listener, the fake has
    // dropped it, so no listener runs and no timer is armed.
    fake.fireActivity('agent_start');
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
  });

  it('(d) the fire callback is guarded: it never double-closes after a manual close', async () => {
    const { controller, fake } = await reachLive();

    // Manual close: timer cleared. Then advance past where it WOULD have fired.
    controller.toggle();
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);

    // closeLive() ran exactly once (the manual toggle), never again.
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
  });

  it('(e) re-opens on the next Talk after an idle auto-close', async () => {
    const fake1 = deferredSession();
    const fake2 = deferredSession();
    const sessions = [fake1.session, fake2.session];
    const createSession = vi.fn(() => sessions.shift() ?? fake2.session);
    const fetchToken = vi.fn().mockResolvedValue(EK);
    const controller = createSessionController({ createSession, fetchToken });

    controller.toggle();
    await flush();
    fake1.resolveConnect();
    await flush();
    expect(controller.getStatus()).toEqual({ phase: 'live' });

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS); // auto-close
    expect(controller.getStatus()).toEqual({ phase: 'idle' });
    expect(fake1.close).toHaveBeenCalledTimes(1);

    controller.toggle(); // Talk again → a fresh connect
    await flush();
    fake2.resolveConnect();
    await flush();
    expect(controller.getStatus()).toEqual({ phase: 'live' });
    expect(createSession).toHaveBeenCalledTimes(2);
  });
});
