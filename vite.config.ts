import { defineConfig } from 'vite';

// Vite dev-server config for the MVP-0 laptop browser spike.
//
// The only thing we configure here is the `/token` proxy: the page POSTs to a
// same-origin `/token`, and the dev server forwards it to the local token
// process on 127.0.0.1:8787 (STACK.md "The token process"). Going same-origin
// means no CORS handshake and no cross-origin credential surface — this lands
// the browser-wiring decision that issue #3 explicitly deferred to #4
// (STACK.md: "The browser wiring … lands in issue #4").
export default defineConfig({
  server: {
    proxy: {
      '/token': 'http://127.0.0.1:8787',
    },
  },
});
