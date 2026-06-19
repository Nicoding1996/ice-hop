import { context, requestExpandedMode } from '@devvit/web/client';

const startButton = document.getElementById('start-button');
startButton?.addEventListener('click', (e) => {
  // Open the expanded Phaser view (the 'game' entrypoint in devvit.json).
  requestExpandedMode(e, 'game');
});

const greeting = document.getElementById('greeting');
if (greeting) {
  greeting.textContent = context.username ? `Hi ${context.username} - ready to dive in?` : 'A daily ice puzzle';
}
