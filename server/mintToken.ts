// Pure, testable token-minting logic for the local ephemeral-token endpoint.
//
// This module performs NO port binding and reads NO process env: it takes the
// API key and a fetch implementation as inputs so it can be unit-tested without
// a network or a real key. The impure I/O shell lives in `token.ts`.
//
// Security contract (CLAUDE.md §7, STACK.md "Connection / security"):
//   - The raw API key only ever appears in the outgoing Authorization header.
//   - The returned value is a FRESH `{ value }` object — we never spread or
//     forward the upstream JSON, so no upstream field can leak to the browser.
//   - On any failure we return a generic status and never surface the upstream
//     body/status text or the API key.

/** The single field we expose to the browser: the ephemeral client secret. */
export type EphemeralToken = { value: string };

/** Result of a mint attempt. Failure carries only a coarse HTTP status. */
export type MintResult = { ok: true; token: EphemeralToken } | { ok: false; status: 502 };

type FetchImpl = typeof fetch;

export type MintClientTokenInput = {
  apiKey: string;
  fetchImpl: FetchImpl;
  model?: string;
};

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const DEFAULT_MODEL = 'gpt-realtime-2';

/**
 * Extract the ephemeral secret defensively from BOTH documented response
 * shapes: a top-level `value`, or a nested `client_secret.value`. The exact
 * upstream field path is not live-verified (STACK.md "To confirm"), so we
 * accept either and validate the result is a string starting with `ek_`.
 *
 * Returns the validated secret string, or `null` if neither shape yields a
 * valid `ek_` value.
 */
function extractEphemeralValue(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const record = body as Record<string, unknown>;

  const topLevel = record.value;
  if (typeof topLevel === 'string' && topLevel.startsWith('ek_')) {
    return topLevel;
  }

  const nested = record.client_secret;
  if (typeof nested === 'object' && nested !== null) {
    const nestedValue = (nested as Record<string, unknown>).value;
    if (typeof nestedValue === 'string' && nestedValue.startsWith('ek_')) {
      return nestedValue;
    }
  }

  return null;
}

/**
 * Mint a short-lived ephemeral client secret by calling OpenAI's
 * `client_secrets` endpoint. The API key travels only in the Authorization
 * header; the result is a hand-built `{ value }` whitelist.
 *
 * Any non-2xx response, missing/invalid `ek_` value, or thrown fetch
 * (network/DNS/abort) collapses to `{ ok: false, status: 502 }` with no
 * upstream detail leaked.
 */
export async function mintClientToken({
  apiKey,
  fetchImpl,
  model = DEFAULT_MODEL,
}: MintClientTokenInput): Promise<MintResult> {
  let response: Response;
  try {
    response = await fetchImpl(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: { type: 'realtime', model } }),
    });
  } catch {
    // Network/DNS/abort: never surface the cause (could echo the request).
    return { ok: false, status: 502 };
  }

  if (!response.ok) {
    return { ok: false, status: 502 };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 502 };
  }

  const value = extractEphemeralValue(body);
  if (value === null) {
    return { ok: false, status: 502 };
  }

  // FRESH object — do not spread the upstream JSON. Only `value` crosses out.
  return { ok: true, token: { value } };
}

/** Outcome of routing an incoming request to the endpoint. */
export type RouteResult = { kind: 'mint' } | { kind: 'methodNotAllowed' } | { kind: 'notFound' };

/**
 * Route a request by method + path. Only `POST /token` mints; the correct path
 * with the wrong method is 405; anything else is 404. The endpoint takes no
 * client input, so nothing past the method and path is inspected.
 */
export function routeTokenRequest(method: string | undefined, path: string): RouteResult {
  if (path !== '/token') {
    return { kind: 'notFound' };
  }
  if (method !== 'POST') {
    return { kind: 'methodNotAllowed' };
  }
  return { kind: 'mint' };
}
