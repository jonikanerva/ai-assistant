// Impure I/O shell for the local ephemeral-token endpoint.
//
// This is the only file that holds the API key and binds a port. It reads
// `OPENAI_API_KEY` once at startup, binds localhost-only, and delegates all
// minting/routing logic to the pure helpers in `mintToken.ts`.
//
// Run it with: `pnpm run token` (which supplies the key via `--env-file=.env`).
// It is a SEPARATE process, not part of `verify` (which must stay keyless-green).
//
// Security contract (CLAUDE.md §7, STACK.md "Connection / security"):
//   - The key lives only here; it is never logged and never sent to the browser.
//   - We bind 127.0.0.1 only (never 0.0.0.0) — localhost-reachable only.
//   - No request body is read, parsed, or trusted: the model is server-fixed.
//   - Responses leak no upstream detail; errors are generic.
//   - The only logging is a single lifecycle line on listen / fatal startup.

import http from 'node:http';
import { mintClientToken, routeTokenRequest } from './mintToken.ts';

const HOST = '127.0.0.1';
const PORT = 8787;

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey === '') {
  // Name the env var; never echo any value.
  process.stderr.write('OPENAI_API_KEY is not set — cannot start token server\n');
  process.exit(1);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // Path only; query strings are irrelevant to this single-purpose endpoint.
  const path = (req.url ?? '').split('?', 1)[0] ?? '';
  const route = routeTokenRequest(req.method, path);

  if (route.kind === 'notFound') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (route.kind === 'methodNotAllowed') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  // mint — no request body is read or trusted.
  mintClientToken({ apiKey, fetchImpl: fetch })
    .then((result) => {
      if (result.ok) {
        sendJson(res, 200, { value: result.token.value });
      } else {
        sendJson(res, 502, { error: 'token_mint_failed' });
      }
    })
    .catch(() => {
      // Defensive: mintClientToken already swallows failures, but never let an
      // unexpected rejection surface a stack/detail to the client.
      sendJson(res, 502, { error: 'token_mint_failed' });
    });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`port ${PORT} in use — cannot start token server\n`);
  } else {
    process.stderr.write('token server failed to start\n');
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`token server listening on http://${HOST}:${PORT}\n`);
});
