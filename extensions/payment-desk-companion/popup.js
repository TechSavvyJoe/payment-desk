import { captureListing } from './captureListing.js';
import { parseAdvertisedPrice, PAYMENT_DESK_URL, vehicleHandoffUrl } from './vehicleHandoff.js';

const nameInput = document.getElementById('vehicle-name');
const stockInput = document.getElementById('stock');
const priceInput = document.getElementById('price');
const captureButton = document.getElementById('capture');
const notice = document.getElementById('notice');
const showNotice = (text, error = false) => {
  notice.textContent = text;
  notice.classList.toggle('is-error', error);
};
document.getElementById('open-desk').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: PAYMENT_DESK_URL }); }
  catch { showNotice('Payment Desk could not be opened. Try again.', true); }
});
captureButton.addEventListener('click', async () => {
  captureButton.disabled = true;
  showNotice('Reading vehicle details…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url ?? '')) throw new Error('Restricted page');
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureListing });
    const details = injection?.result;
    if (!details) throw new Error('No details');
    nameInput.value = details.name;
    stockInput.value = details.stock;
    priceInput.value = details.price === null ? '' : String(details.price);
    priceInput.removeAttribute('aria-invalid');
    document.getElementById('source').textContent = `From ${details.sourceHost}`;
    showNotice(details.notice);
  } catch {
    showNotice('This page cannot be read. Open a normal vehicle listing and click the toolbar icon again, or enter the details below.', true);
  } finally {
    captureButton.disabled = false;
  }
});
document.getElementById('vehicle-form').addEventListener('submit', async event => {
  event.preventDefault();
  priceInput.removeAttribute('aria-invalid');
  const salePrice = priceInput.value.trim() ? parseAdvertisedPrice(priceInput.value) : null;
  if (priceInput.value.trim() && salePrice === null) {
    priceInput.setAttribute('aria-invalid', 'true');
    showNotice('Enter a USD selling price above $0 and up to $1,000,000, with at most two decimal places.', true);
    priceInput.focus();
    return;
  }
  const vehicleDescription = [nameInput.value.trim(), stockInput.value.trim() ? `Stock ${stockInput.value.trim()}` : ''].filter(Boolean).join(' · ');
  try {
    const url = vehicleHandoffUrl({ salePrice, vehicleDescription });
    await chrome.tabs.create({ url });
    // Clear transient details after a successful handoff.
    document.getElementById('vehicle-form').reset();
    showNotice('Opened in Payment Desk. Confirm the vehicle there to start the estimate.');
  } catch (error) {
    showNotice(error.message === 'Enter a vehicle reference or a valid selling price.' ? error.message : 'Payment Desk could not be opened. Try again.', true);
  }
});
