import { describe, expect, it, vi } from 'vitest';
import {
  type ControllableSession,
  createSessionController,
  fetchEphemeralToken,
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
  resolveConnect: () => void;
  rejectConnect: (error: unknown) => void;
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
  return {
    session: { connect, close },
    connect,
    close,
    // Delegate through the closures so callers always settle the live promise,
    // not a stale reference captured before connect() ran.
    resolveConnect: () => innerResolve(),
    rejectConnect: (error: unknown) => innerReject(error),
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
