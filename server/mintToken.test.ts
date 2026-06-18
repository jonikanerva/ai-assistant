import { describe, expect, it, vi } from 'vitest';
import { mintClientToken, routeTokenRequest } from './mintToken.ts';

const API_KEY = 'sk-proj-secret-test-key-do-not-leak';
const EK = 'ek_test_1234567890';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('mintClientToken — happy path', () => {
  it('extracts a top-level `value`', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ value: EK }));

    const result = await mintClientToken({ apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({ ok: true, token: { value: EK } });
  });

  it('extracts a nested `client_secret.value`', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse({ client_secret: { value: EK }, session: { id: 'x' } }));

    const result = await mintClientToken({ apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({ ok: true, token: { value: EK } });
  });

  it('returns ONLY `{ value }` and never leaks the key on success', async () => {
    // Upstream returns extra fields that must not be forwarded.
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        value: EK,
        api_key_echo: API_KEY,
        session: { type: 'realtime', secret: 'should-not-forward' },
      }),
    );

    const result = await mintClientToken({ apiKey: API_KEY, fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    // Exactly one key on the token object.
    expect(Object.keys(result.token)).toEqual(['value']);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain('should-not-forward');
    expect(serialized).not.toContain('session');
  });

  it('sends the Bearer header and the exact fixed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ value: EK }));

    await mintClientToken({ apiKey: API_KEY, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');

    expect(init.body).toBe(
      JSON.stringify({ session: { type: 'realtime', model: 'gpt-realtime-2' } }),
    );
  });

  it('honours an explicit model override in the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ value: EK }));

    await mintClientToken({ apiKey: API_KEY, fetchImpl, model: 'gpt-realtime-next' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({ session: { type: 'realtime', model: 'gpt-realtime-next' } }),
    );
  });
});

describe('mintClientToken — failure modes (key never leaks)', () => {
  it('returns 502 when fetch THROWS and leaks nothing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`boom with ${API_KEY} inside`));

    const result = await mintClientToken({ apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({ ok: false, status: 502 });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it('returns 502 on a non-2xx response with a secret-looking body, leaking nothing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      errorResponse(401, {
        error: { message: 'invalid key', value: 'ek_should_not_be_used' },
      }),
    );

    const result = await mintClientToken({ apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({ ok: false, status: 502 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain('ek_should_not_be_used');
    expect(serialized).not.toContain('invalid key');
  });

  it('returns 502 when the success body has a value not starting with ek_', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ value: 'sk-not-ephemeral' }));

    const result = await mintClientToken({ apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({ ok: false, status: 502 });
  });

  it('returns 502 when the success body has no value at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ session: { id: 'x' } }));

    const result = await mintClientToken({ apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({ ok: false, status: 502 });
  });

  it('returns 502 when the body is not valid JSON', async () => {
    const badResponse = new Response('not json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchImpl = vi.fn().mockResolvedValue(badResponse);

    const result = await mintClientToken({ apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({ ok: false, status: 502 });
  });
});

describe('routeTokenRequest', () => {
  it('routes POST /token to mint', () => {
    expect(routeTokenRequest('POST', '/token')).toEqual({ kind: 'mint' });
  });

  it('routes GET /token to methodNotAllowed', () => {
    expect(routeTokenRequest('GET', '/token')).toEqual({ kind: 'methodNotAllowed' });
  });

  it('routes an undefined method on /token to methodNotAllowed', () => {
    expect(routeTokenRequest(undefined, '/token')).toEqual({ kind: 'methodNotAllowed' });
  });

  it('routes any other path to notFound', () => {
    expect(routeTokenRequest('POST', '/other')).toEqual({ kind: 'notFound' });
    expect(routeTokenRequest('GET', '/')).toEqual({ kind: 'notFound' });
  });
});
