# Bob

A Finnish-speaking home voice assistant that feels like ChatGPT's voice mode — as
its own device at home, hands-free. It rides on the OpenAI Realtime API
(speech-to-speech) so new platform capabilities arrive without us building them.

- **North star** → [VISION.md](VISION.md)
- **Architecture, stack & sequencing** → [STACK.md](STACK.md)
- **How we work (engineering doctrine)** → [CLAUDE.md](CLAUDE.md)
- **Backlog & roadmap** → GitHub **Issues + Milestones** (not in this repo)

## Status

Design + scaffolding. **MVP-0 is not yet implemented** — the first product issue is
the laptop browser spike (ephemeral-token process + page + hosted `web_search`).

## Requirements

[**mise**](https://mise.jdx.dev) is required for development — it pins the toolchain
(Node 24 LTS) so everyone runs the same versions.

## Setup

```sh
mise install        # installs Node 24, then runs `npm install` (postinstall hook)
cp .env.example .env # add your OPENAI_API_KEY — used only by the token process
```

## Verify

```sh
npm run verify      # or: mise run verify
```

`verify` is the gate every PR must pass: **typecheck** (`tsc`) + **lint & format**
(`biome ci`) + **tests** (`vitest`). CI runs the same on every PR
(`.github/workflows/ci.yml`).

Convenience: `npm run check:fix` (Biome autofix), `npm run format`. The `dev` /
`build` scripts arrive with the MVP-0 implementation (they depend on the page's
bundler).

## Repo map

| Path                      | What                                                 |
| ------------------------- | ---------------------------------------------------- |
| `VISION.md`               | Product north star + Decision Filter                 |
| `STACK.md`                | Architecture, stack, engineering baseline, phasing   |
| `CLAUDE.md`               | Engineering doctrine — how we work                    |
| `mise.toml`               | Dev toolchain (Node) + one-command setup             |
| `biome.json` `tsconfig.json` `vitest.config.ts` | Lint/format, types, tests      |
| `.github/workflows/ci.yml`| Runs `verify` on every PR                            |

## How work happens

The backlog is GitHub Issues; phases are GitHub Milestones (MVP-0 → Later). Work is
driven by an agent team led by a Project Manager — see [CLAUDE.md](CLAUDE.md) §8.
The audit trail of what happened and why lives in issues, commit messages, and PR
descriptions.
