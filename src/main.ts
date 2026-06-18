// Page entry point: the Talk toggle wiring.
//
// This is the interface layer — it only translates DOM events into controller
// calls and controller status back into the button label + status text. All
// lifecycle logic lives in `session.ts`; all SDK wiring in `realtimeSession.ts`.
// No framework, no CSS framework, no app shell (STACK.md MVP-0: "one page").

import { createRealtimeSession } from './realtimeSession.ts';
import { createSessionController, fetchEphemeralToken, type SessionStatus } from './session.ts';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  const heading = document.createElement('h1');
  heading.textContent = 'Bob — MVP-0';
  app.prepend(heading);
}

const talkButton = document.querySelector<HTMLButtonElement>('#talk');
const statusText = document.querySelector<HTMLParagraphElement>('#status');

if (talkButton && statusText) {
  const controller = createSessionController({
    createSession: createRealtimeSession,
    fetchToken: fetchEphemeralToken,
  });

  // Finnish UI strings, minimal. The button label is the action the user can
  // take next; the status line states where we are.
  const render = (status: SessionStatus): void => {
    switch (status.phase) {
      case 'idle':
        talkButton.textContent = 'Puhu';
        statusText.textContent = 'Idle';
        return;
      case 'connecting':
        talkButton.textContent = 'Keskeytä';
        statusText.textContent = 'Yhdistetään…';
        return;
      case 'live':
        talkButton.textContent = 'Lopeta';
        statusText.textContent = 'Yhteydessä';
        return;
      case 'error':
        talkButton.textContent = 'Puhu';
        statusText.textContent =
          status.reason === 'mic-denied' ? 'Mikrofoni estetty' : 'Yhteys epäonnistui';
        return;
    }
  };

  controller.subscribe(render);
  talkButton.addEventListener('click', () => {
    controller.toggle();
  });
}
