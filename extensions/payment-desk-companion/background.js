import { PAYMENT_DESK_URL } from './vehicleHandoff.js';

// Optional shortcut: assign a key at chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener(command => {
  if (command === 'open-payment-desk') chrome.tabs.create({ url: PAYMENT_DESK_URL });
});
