# Bob — Product Vision (North Star)

> Updated: 2026-06-18 · Status: vision + design, not yet implemented

## In a nutshell

**Bob** is a Finnish-speaking home voice assistant that feels as natural as
ChatGPT's "voice mode." It wakes to its name, converses freely in Finnish,
fetches fresh information from the web, and handles even hard calculations — and
it rides on top of the OpenAI API so that new capabilities become available
without us building them ourselves.

## North Star — what Bob feels like, finished

In the kitchen, hands in the dough, you say *"Hei Bob"* — the device gives a soft
acknowledgment and is ready. You talk to it like a person: ask, clarify,
interrupt it mid-answer, change the subject. It responds in a natural Finnish
voice, without robotic stiffness. You ask *"find the latest news about X"* or
*"calculate how interest accrues over five years,"* and it searches or computes
and speaks the answer aloud. No screen is needed, no button must be pressed. The
device is unobtrusive, always ready, and stays quiet and private until you call
on it.

In other words, it is the ChatGPT voice mode experience, but **as its own device
at home**, in Finnish, and hands-free.

## Who it's for, and when

A personal home and desk device (single user). Typical situations:

- **Hands occupied** — kitchen, crafts, workouts: ask and get the answer aloud.
- **Quick lookups** — fresh information from the web without opening a device.
- **Calculation and reasoning** — interest, conversions, "which is better"
  comparisons.
- **Later** — calendar, reminders, home devices (as tools; see the phasing in
  STACK.md and the GitHub Milestones).

## What "good" means (experience goals)

1. **Natural Finnish.** The voice doesn't grate and doesn't sound like a
   translation machine. This is both the most important goal and the biggest
   open risk (see STACK.md).
2. **Conversational, not command-based.** You can speak casually, clarify, and
   wander off topic.
3. **Interruptible (barge-in).** You can cut Bob off mid-speech, like a person.
4. **Feels instant.** Response in the sub-second range.
5. **Hands-free wake.** "Hei Bob" is enough — no mandatory button (in the target
   state).
6. **Quiet until called.** It does not stream to the cloud before the wake.

## Product principles

1. **Ride the platform; don't compete with it.** We build as little of our own
   logic as possible and lean on the OpenAI API. When the platform improves
   (better voice, new tools, better reasoning), Bob improves for free. This is
   both a product and a technology principle.
2. **Start with the thinnest thing that validates the risk.** The first version
   proves the core experience (natural Finnish + conversation + search) with the
   least possible effort, before hardware and the "always on" layer.
3. **Add features additively.** Every new capability (wake word, physical button,
   memory, home automation) attaches without a rewrite.
4. **Privacy by default.** The microphone streams nothing before a wake or a
   button press.

## Decision Filter

Before a feature or solution is taken on board, it passes these:

1. **Does it move us toward the north star** — natural, hands-free, Finnish
   conversation? If not, it isn't part of the core.
2. **Can it be delegated to the platform** instead of us building it? If yes,
   delegate it (see principle 1).
3. **Is it additive** or does it force a rewrite? Prefer additive.
4. **Is privacy preserved** (no always-listening to the cloud without a wake)?
5. **Is it needed now**, or does something thinner validate the same thing?

## Non-goals — what Bob is not

- **Not a commercial multi-user product.** A personal home device; we don't scale
  or optimize for many users.
- **Not our own ASR/TTS/LLM.** We don't train or operate our own speech/language
  models — we lean on the platform.
- **Not a screen-centric UI.** Voice first; any screen is secondary.
- **Not our own conversation-memory or database layer**, unless it's available as
  a (hosted) platform service.
- **Not offline.** Bob is a networked device.
- **Not a broad home-automation platform.** Home control may come in *as a tool*,
  not as the product's core.

## Success metrics (at the north-star level)

- You use Bob **daily** and hands-free.
- The Finnish voice **doesn't grate** even in prolonged use.
- The response feels **immediate**.
- You **rarely** have to repeat yourself or correct a misunderstanding.

## The path there

The technical implementation path, phases, and decisions are documented
separately in [STACK.md](STACK.md). In short: the first version (MVP-0) is a thin
spike on a personal laptop that proves the core experience; hardware, "always
on," and the wake word are added only after the core has been shown to work.
