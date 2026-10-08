import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const loaderSource = readFileSync(new URL('../extensions/payment-desk-companion/worksheetLoader.js', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../extensions/payment-desk-companion/sidepanel.js', import.meta.url), 'utf8');
const panelHtml = readFileSync(new URL('../extensions/payment-desk-companion/sidepanel.html', import.meta.url), 'utf8');

function harness() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, disabled: false, textContent: '', listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
    });
    return elements.get(id);
  };
  const desk = element('desk');
  const timers = new Map();
  const frames = [];
  const observers = [];
  const states = [];
  let nextTimer = 0;
  let navigations = 0;
  Object.defineProperty(desk, 'src', { set() { navigations++; } });
  const context = vm.createContext({
    URL,
    document: { readyState: 'complete', getElementById: element },
    window: { addEventListener() {} },
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(doc) { this.doc = doc; }
      disconnect() { this.disconnected = true; }
    },
    onReady: () => states.push(true),
    onUnavailable: () => states.push(false),
  });
  vm.runInContext(loaderSource.replace('export function', 'function') + '\ninstallWorksheet(onReady, onUnavailable);', context);
  const load = (healthy, url = 'https://extension.test/desk/index.html') => {
    desk.contentDocument = { URL: url, readyState: 'complete', getElementById: () => healthy ? { value: '30000' } : null };
    desk.listeners.load();
  };
  return {
    element, desk, timers, observers, states, load,
    get navigations() { return navigations; },
    paint: () => { while (frames.length) frames.shift()(); },
    timeout: () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    retry: () => element('worksheet-retry').listeners.click(),
  };
}

test('initial timeout exposes retry; successful retry clears its timer', () => {
  const h = harness();
  assert.equal(h.navigations, 0);
  h.paint();
  h.timeout();
  assert.equal(h.element('worksheet-retry').hidden, false);
  h.retry();
  h.load(true);
  assert.deepEqual(h.states, [true]);
  assert.equal(h.element('worksheet-loading').hidden, true);
  assert.equal(h.timers.size, 0);
});

test('ready worksheet losing its input resets readiness and re-arms recovery', () => {
  const h = harness();
  h.paint();
  h.load(true);
  h.load(false);
  assert.deepEqual(h.states, [true, false]);
  assert.equal(h.element('worksheet-loading').hidden, false);
  assert.equal(h.timers.size, 1);
  h.timeout();
  assert.equal(h.element('worksheet-retry').hidden, false);
  h.retry();
  h.load(true);
  assert.deepEqual(h.states, [true, false, true]);
  assert.equal(h.timers.size, 0);
});

test('unexpected iframe document also resets readiness and allows retry', () => {
  const h = harness();
  h.paint();
  h.load(true);
  h.load(false, 'about:blank');
  assert.deepEqual(h.states, [true, false]);
  h.timeout();
  assert.equal(h.element('worksheet-retry').hidden, false);
  h.retry();
  h.load(true);
  assert.deepEqual(h.states, [true, false, true]);
});

test('repeated failed loads replace the timer and disconnect the old observer', () => {
  const h = harness();
  h.paint();
  h.load(true);
  h.load(false);
  const oldTimer = [...h.timers.keys()][0];
  const oldObserver = h.observers.at(-1);
  h.load(false);
  assert.equal(oldObserver.disconnected, true);
  assert.equal(h.timers.has(oldTimer), false);
  assert.equal(h.timers.size, 1);
  assert.deepEqual(h.states, [true, false]);
});

test('late React commit recovers without an iframe navigation', () => {
  const h = harness();
  h.paint();
  h.load(true);
  h.load(false);
  h.desk.contentDocument.getElementById = () => ({ value: '30000' });
  h.observers.at(-1).callback();
  assert.deepEqual(h.states, [true, false, true]);
  assert.equal(h.navigations, 1);
  assert.equal(h.timers.size, 0);
});

test('stale retry and a healthy reload leave the active worksheet untouched', () => {
  const h = harness();
  h.paint();
  h.load(true);
  const activeDocument = h.desk.contentDocument;
  h.retry();
  h.desk.listeners.load();
  assert.equal(h.desk.contentDocument, activeDocument);
  assert.equal(h.navigations, 1);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.states, [true]);
});

test('parent review gating follows readiness and retains capture gating', () => {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, { disabled: false, addEventListener() {} });
    return elements.get(id);
  };
  let ready;
  let unavailable;
  const context = vm.createContext({
    document: { getElementById },
    installInventoryPanel: () => ({}),
    installWorksheet: (onReady, onUnavailable) => { ready = onReady; unavailable = onUnavailable; },
  });
  vm.runInContext(panelSource.replace(/^import .*;\n/gm, ''), context);
  const review = getElementById('start-estimate');
  ready();
  assert.equal(review.disabled, false);
  unavailable();
  assert.equal(review.disabled, true);
  getElementById('capture').disabled = true;
  ready();
  assert.equal(review.disabled, true);
  getElementById('capture').disabled = false;
  ready();
  assert.equal(review.disabled, false);
});

test('troubleshooting is static visible HTML independent of module execution', () => {
  assert.match(panelHtml, /<p class="source">[^<]*complete[^<]*package[^<]*chrome:\/\/extensions[^<]*Reload[^<]*<\/p>/);
});
