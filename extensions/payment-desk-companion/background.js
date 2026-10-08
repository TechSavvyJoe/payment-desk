import { installInventory } from './inventoryBackground.js';
import { installInventoryWeb } from './inventoryWeb.js';

installInventory();
installInventoryWeb();

// An action listener grants activeTab on the selected listing and opens (or
// keeps open) the global panel. Clicking again on a new tab authorizes that tab
// without toggling away the live worksheet.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(error => console.error('Could not configure Payment Desk side panel', error));
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(error => console.error('Could not open Payment Desk side panel', error));
});

// Optional shortcut: assign a key at chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-payment-desk' && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(error => console.error('Could not open Payment Desk side panel', error));
  }
});
