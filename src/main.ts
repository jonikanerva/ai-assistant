const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  const heading = document.createElement('h1');
  heading.textContent = 'Bob — MVP-0';
  app.append(heading);
}
