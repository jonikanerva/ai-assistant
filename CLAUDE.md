# Engineering Doctrine — Bob

> The operating contract for everyone working in this repo: the human and the
> agent team. It is the source of truth for **how we work**.
>
> - **Why** we build → [VISION.md](VISION.md) (north star + Decision Filter)
> - **How / what stack** → [STACK.md](STACK.md) (architecture, stack, sequencing)
> - **What to do now** → the GitHub Issue you're working on
>
> The **backlog and roadmap live in GitHub Issues + Milestones**, never in repo
> files. There is no `ROADMAP.md`, backlog file, or changelog here.

## 0. Read order

VISION.md (why) → STACK.md (how + stack) → this file (how we work) → the issue.

## 1. Prime directive — thin client

Build as little of our own logic as possible; lean on the OpenAI platform and the
browser. Every line we own must justify why it can't be delegated to the platform
(STACK.md → "Thin-client principle"). When the platform improves, Bob improves for
free. The thin waist is **declarative session configuration**, not our own
subsystems.

## 2. Autonomy fallback

When working autonomously and an ambiguity arises that you cannot resolve from the
issue, VISION.md, STACK.md, or this file:

1. Choose the interpretation that best satisfies VISION.md's **Decision Filter**
   and the thin-client directive.
2. Pick the **smallest, most additive, most reversible** option.
3. Prefer **delegating to the platform** over building our own.
4. **Record the assumption** explicitly in the PR description
   ("Assumption: … because …").
5. Do not block on the user mid-flight, and do not silently expand scope.

## 3. Definition of done

A change is done only when **all** hold:

- It satisfies the issue's acceptance criteria (or the agreed scope).
- `$VERIFY_CMD` (`npm run verify`, see STACK.md) passes locally and is green.
- New behaviour has a test (Vitest), unless it is pure config/docs.
- No new dependency outside STACK.md's **Approved dependencies** (see §5).
- No **Reject list** pattern introduced (STACK.md → "Reject list").
- The diff is minimal and reads like the surrounding code.
- The PR links the issue (`Closes #<N>`) and records any assumptions / scope cuts.

## 4. Git workflow

- **Never** commit to or push `main`. **Never** force-push. **Never** `--no-verify`.
- One **feature branch per issue**: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`,
  `docs/<slug>` — ≤50 chars, lowercase, hyphens.
- **Conventional Commits**: `feat: …`, `fix: …`, `chore: …`, `docs: …`.
- One **PR per issue**, with `Closes #<N>` in the body.
- Merge with a **merge commit — never squash**. Delete the branch after merge.
- The **audit trail** is issues + commits + PR descriptions + the merge-commit
  chain on `main`. A decision that binds future work goes into the issue and the PR
  that introduced it, in plain language ("we chose X over Y because Z") — never an
  opaque "did X".
- Convert relative dates to ISO `YYYY-MM-DD` before writing them anywhere.

## 5. Dependencies

- Default to **zero** new runtime dependencies. The platform and the browser do the
  heavy lifting.
- A new runtime dependency requires **all** of: it can't be delegated to the
  platform, it is on (or added to) STACK.md's Approved dependencies, and the PR
  explains why.
- Dev tooling (Node, TypeScript, Biome, Vitest) is fixed by STACK.md — don't swap it
  casually. Node version and TS strictness are **user-owned** (do not change them).

## 6. Code quality

- TypeScript `strict`. No `any` escape hatch without a written reason.
- Small, declarative, boring. No premature abstraction, speculative generality, or
  dead code.
- **Biome** is the single source of truth for formatting and linting — match it,
  don't fight it.

## 7. Secrets & privacy

- `OPENAI_API_KEY` lives only in the local token process via `.env` (gitignored).
  **Never** in the browser, the repo, or client code.
- The browser connects with a **short-lived ephemeral token** only.
- **No microphone stream before an explicit user gesture / wake** (VISION.md privacy
  principle).

## 8. How work happens — the agent team

The **Project Manager** is the only surface that talks to the user (in Finnish);
everything written to the repo or GitHub is in English. For every issue the PM
convenes the full team and scales depth, not roster:

- **architect** — designs the implementation; enforces this doctrine + STACK.md.
- **ux-guardian** — runs the VISION.md Decision Filter on the scope.
- **devils-advocate** — stress-tests the plan/design before code.
- **lead-dev** — implements on a feature branch, runs `$VERIFY_CMD`, opens the PR.
- **qa-enforcer** — runs `/codereview` to PASS before the PR is surfaced.

A PR reaches the user only after the team's `/codereview` is **PASS**.
