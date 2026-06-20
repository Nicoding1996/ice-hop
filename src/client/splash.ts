import { context, requestExpandedMode } from '@devvit/web/client';

const startButton = document.getElementById('start-button');
startButton?.addEventListener('click', (e) => {
  // Open the expanded Phaser view (the 'game' entrypoint in devvit.json).
  requestExpandedMode(e, 'game');
});

const meta = document.getElementById('meta');
if (meta) {
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  meta.textContent = context.username ? `${date}  -  hi ${context.username}` : date;
}
