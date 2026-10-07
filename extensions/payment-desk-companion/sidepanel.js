import { captureListing } from './captureListing.js';
import { parseAdvertisedPrice, PAYMENT_DESK_URL, vehicleHandoffUrl } from './vehicleHandoff.js';

const nameInput = document.getElementById('vehicle-name');
const stockInput = document.getElementById('stock');
const priceInput = document.getElementById('price');
const captureButton = document.getElementById('capture');
const toggleButton = document.getElementById('toggle-vehicle');
const controls = document.getElementById('vehicle-controls');
const desk = document.getElementById('desk');
const notice = document.getElementById('notice');
const reviewButton = document.getElementById('start-estimate');
let worksheetReady = false;
const updateReviewButton = () => { reviewButton.disabled = !worksheetReady || captureButton.disabled; };
const showNotice = (text, error = false) => {
  notice.textContent = text;
  notice.classList.toggle('is-error', error);
};
const showControls = open => {
  controls.hidden = !open;
  toggleButton.setAttribute('aria-expanded', String(open));
  toggleButton.textContent = open ? 'Hide vehicle' : 'Enter vehicle';
};
const enableWorksheet = () => {
  // A cached worksheet may finish loading before this module's imports finish.
  // Do not mistake the iframe's initial about:blank document for the worksheet.
  if (desk.contentWindow.location.pathname === '/desk/index.html' && desk.contentDocument.readyState === 'complete') {
    worksheetReady = true;
    updateReviewButton();
  }
};
desk.addEventListener('load', enableWorksheet);
enableWorksheet();
toggleButton.addEventListener('click', () => {
  showControls(controls.hidden);
  if (!controls.hidden) nameInput.focus();
});
document.getElementById('open-desk').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: PAYMENT_DESK_URL }); }
  catch { showControls(true); showNotice('The web app could not be opened. You can continue in the worksheet below.', true); }
});
captureButton.addEventListener('click', async () => {
  showControls(true);
  captureButton.disabled = true;
  updateReviewButton();
  // Starting another capture invalidates the previous vehicle even if the new
  // tab cannot be read. Never leave the last listing available for submission.
  document.getElementById('vehicle-form').reset();
  priceInput.removeAttribute('aria-invalid');
  document.getElementById('source').textContent = 'Reading the current listing…';
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
    document.getElementById('source').textContent = 'Enter the vehicle details manually.';
    showNotice('This page cannot be read. Open a vehicle listing and click the toolbar icon to allow capture on that tab, or enter the details here.', true);
  } finally {
    captureButton.disabled = false;
    updateReviewButton();
  }
});
document.getElementById('vehicle-form').addEventListener('submit', event => {
  event.preventDefault();
  if (reviewButton.disabled) return;
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
    // Same-origin packaged app: the existing import dialog reviews the data without
    // reloading the worksheet or clearing an active deal before confirmation.
    desk.contentWindow.location.hash = new URL(url).hash;
    document.getElementById('vehicle-form').reset();
    showControls(false);
    showNotice('Review the captured vehicle in the worksheet.');
    desk.focus();
  } catch (error) {
    showNotice(error.message === 'Enter a vehicle reference or a valid selling price.' ? error.message : 'The worksheet is still loading. Try again.', true);
  }
});
