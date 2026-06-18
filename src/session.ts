// Session lifecycle logic for the Talk toggle — the only code in this feature
// we actually own, and therefore the only part we unit-test.
//
// Responsibilities:
//   - fetch the ephemeral token from the same-origin `/token` proxy and validate
//     its shape (`fetchEphemeralToken`);
//   - drive a small idle → connecting → live state machine in response to the
//     Talk toggle (`createSessionController`).
//
// What it deliberately does NOT do: own the microphone, audio buffering, VAD,
// transport selection, or any retry/reconnect policy. The SDK and the browser
// own all of that (STACK.md Reject list). We never log the token or the apiKey
// (CLAUDE.md §7).

/** Typed failure for a token fetch — keeps the controller's error paths legible. */
export class TokenFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenFetchError';
  }
}

/**
 * Fetch a short-lived ephemeral token from the same-origin `/token` endpoint
 * (proxied to the local token process by Vite — see `vite.config.ts`). The
 * response is the minted `{ value }` whitelist; we validate it is a non-empty
 * `ek_` string before handing it on, and never log the value.
 *
 * `fetchImpl` is injectable purely so the unit tests can drive it without a
 * network — production callers use the default `fetch`.
 */
export async function fetchEphemeralToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl('/token', { method: 'POST' });
  if (!response.ok) {
    throw new TokenFetchError(`token endpoint returned ${response.status}`);
  }

  const body: unknown = await response.json();
  const value = (body as { value?: unknown } | null)?.value;
  if (typeof value !== 'string' || !value.startsWith('ek_')) {
    throw new TokenFetchError('token endpoint returned no valid ephemeral value');
  }
  return value;
}

/**
 * The minimal slice of the SDK's RealtimeSession the controller actually calls.
 * Deliberately NOT a broad transport/config interface — the controller only
 * connects and closes, so it only depends on those two methods (CLAUDE.md §6:
 * no premature abstraction). `createRealtimeSession()` returns a value that
 * satisfies this structurally.
 */
export type ControllableSession = {
  connect(opts: { apiKey: string }): Promise<void>;
  close(): void;
};

/**
 * The phase the UI reflects. `connecting` covers the up-to-~5s window while the
 * SDK opens WebRTC and waits for `session.updated`; `error` carries a coarse
 * reason so the button never gets stuck looking like it is still connecting.
 */
export type SessionStatus =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'live' }
  | { phase: 'error'; reason: 'connection-failed' | 'mic-denied' };

type StatusListener = (status: SessionStatus) => void;

export type SessionController = {
  toggle(): void;
  subscribe(listener: StatusListener): () => void;
  /** Current status — exposed for tests and for a listener registered late. */
  getStatus(): SessionStatus;
};

export type SessionControllerDeps = {
  createSession: () => ControllableSession;
  fetchToken: () => Promise<string>;
};

/**
 * A getUserMedia permission denial surfaces as a `NotAllowedError` (the SDK
 * calls getUserMedia inside `connect()`). We special-case it so the UI can say
 * "microphone blocked" rather than the generic "connection failed".
 */
function isMicPermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'NotAllowedError'
  );
}

/**
 * Drive the Talk toggle's lifecycle.
 *
 * Transitions:
 *   - `idle` + toggle → `connecting`: fetchToken → createSession →
 *     `connect({ apiKey })`; on resolve → `live`.
 *   - `live` + toggle → `close()` → `idle`.
 *   - `connecting` + toggle → latch a teardown request (see below).
 *
 * Cancel-during-connecting (privacy-critical, CLAUDE.md §7 / VISION.md privacy):
 * `connect()` can take up to ~5s, and the mic goes live somewhere inside it. If
 * the user toggles off during that window we must NOT drop the request — we
 * latch a flag and, the moment `connect()` settles (resolve OR reject), call
 * `close()` and return to `idle`. This guarantees the mic can never stay live
 * behind an "Idle"-looking button.
 *
 * Failure paths never strand the UI in `connecting`: a token-fetch rejection or
 * a connect rejection drops back to `error: connection-failed`; a mic-permission
 * denial drops to the distinct `error: mic-denied`.
 */
export function createSessionController({
  createSession,
  fetchToken,
}: SessionControllerDeps): SessionController {
  let status: SessionStatus = { phase: 'idle' };
  const listeners = new Set<StatusListener>();

  // The session that is currently connecting or live, if any.
  let session: ControllableSession | null = null;
  // Set when toggle() fires during `connecting`: tear down as soon as connect settles.
  let teardownRequested = false;

  function setStatus(next: SessionStatus): void {
    status = next;
    for (const listener of listeners) {
      listener(status);
    }
  }

  async function startConnecting(): Promise<void> {
    teardownRequested = false;
    setStatus({ phase: 'connecting' });

    let pending: ControllableSession;
    try {
      const apiKey = await fetchToken();
      pending = createSession();
      session = pending;
      await pending.connect({ apiKey });
    } catch (error) {
      // connect()/fetch rejected. Drop the reference and surface a visible error
      // (never stuck in `connecting`). A cancel that raced the failure still
      // ends idle, not error — the user asked to stop.
      session = null;
      if (teardownRequested) {
        teardownRequested = false;
        setStatus({ phase: 'idle' });
        return;
      }
      setStatus(
        isMicPermissionDenied(error)
          ? { phase: 'error', reason: 'mic-denied' }
          : { phase: 'error', reason: 'connection-failed' },
      );
      return;
    }

    // connect() resolved. If the user toggled off while we were connecting, the
    // mic is now live behind an intent to stop — close immediately.
    if (teardownRequested) {
      teardownRequested = false;
      pending.close();
      session = null;
      setStatus({ phase: 'idle' });
      return;
    }
    setStatus({ phase: 'live' });
  }

  function toggle(): void {
    switch (status.phase) {
      case 'idle':
      case 'error':
        void startConnecting();
        return;
      case 'connecting':
        // Latch: do not abandon the in-flight connect; tear down when it settles.
        teardownRequested = true;
        return;
      case 'live':
        session?.close();
        session = null;
        setStatus({ phase: 'idle' });
        return;
    }
  }

  function subscribe(listener: StatusListener): () => void {
    listeners.add(listener);
    listener(status);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    toggle,
    subscribe,
    getStatus: () => status,
  };
}
