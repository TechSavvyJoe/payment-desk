import { parseDealerOn, parseInventoryHtml } from './inventoryParser.js';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'inventory.parser') return;
  try {
    const result = message.task.kind === 'dealeron'
      ? parseDealerOn(JSON.parse(message.body), message.task, message.site, message.now)
      : parseInventoryHtml(message.body, message.task, message.site, message.now);
    respond({ ok: true, result });
  } catch (error) { respond({ ok: false, error: error.message }); }
});
