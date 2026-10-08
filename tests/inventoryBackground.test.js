import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../extensions/payment-desk-companion/inventoryModel.js';
import { dealerOnFullScope, parseDealerOn, parseInventoryHtml } from '../extensions/payment-desk-companion/inventoryParser.js';

const site = 'https://dealer.example.com/';
const source = await readFile(new URL('../extensions/payment-desk-companion/inventoryBackground.js', import.meta.url), 'utf8');
const vehicle = (id, url = `/vehicle/${id}`) => ({ id, url: new URL(url, site).href, listed: true, condition: 'used', lastSeenAt: 1 });
function worker({ queue, pages = {}, parsed = {}, state, permissions = () => true } = {}) {
  let now = 1_800_000_000_000;
  let saved = state ?? { config: { site, nightly: false }, vehicles: [vehicle('A'), vehicle('B')], lastCompletedAt: 123,
    job: { id: 'test', startedAt: now, queue, visited: [], vehicles: [], groups: {}, policies: { [new URL(site).origin]: { rules: [], delay: 1 } }, warnings: [], provider: '', nextRequestAt: 0 } };
  const requests = [], alarms = new Map();
  const chrome = {
    storage: { local: { get: async () => ({ [model.INVENTORY_KEY]: structuredClone(saved) }), set: async value => { saved = structuredClone(value[model.INVENTORY_KEY]); }, remove: async () => { saved = undefined; }, setAccessLevel: async () => {} } },
    permissions: { contains: async ({ origins }) => permissions(origins[0]), remove: async () => true },
    runtime: { getContexts: async () => [{}], getURL: path => `chrome-extension://fixture/${path}`, getManifest: () => ({ host_permissions: [] }), sendMessage: async ({ task }) => ({ ok: true, result: parsed[task.url] }) },
    alarms: { create: async (name, options) => { alarms.set(name, options); }, clear: async name => alarms.delete(name) },
  };
  const sandbox = { ...model, chrome, URL, TextEncoder, TextDecoder, AbortSignal, crypto, Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => { now += delay; fn(); return 1; }, clearTimeout: () => {},
    fetch: async (url, options) => {
      requests.push({ url, at: now, options });
      const page = typeof pages[url] === 'function' ? pages[url]() : pages[url] ?? {};
      const response = new Response(page.body ?? '', { status: page.status ?? 200, headers: page.headers });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    },
  };
  vm.runInNewContext(source.replace(/^import .*;\n/, '').replace('export function installInventory', 'function installInventory') + '\nglobalThis.api = { processBatch, resume, command, schedule };', sandbox);
  return { api: sandbox.api, requests, alarms, saved: () => structuredClone(saved), advance: ms => { now += ms; } };
}
// This harness executes the actual worker with only clock/network/storage substituted.
const pageResult = (rows, finalPage) => ({ vehicles: rows, group: 'all', scope: 'all', expected: 2, finalPage });

test('identical source rows across pages preserve cached absence and completion', async () => {
  const first = `${site}page1`, second = `${site}page2`;
  const fixture = worker({ queue: [first, second].map(url => ({ url, kind: 'html' })), parsed: { [first]: pageResult([vehicle('A')], false), [second]: pageResult([vehicle('A')], true) } });
  await fixture.api.processBatch();
  assert.equal(fixture.saved().status, 'partial');
  assert.equal(fixture.saved().lastCompletedAt, 123);
  assert.equal(fixture.saved().vehicles.find(v => v.id === 'B').listed, true);
});

test('restrictive DealerOn BaseFilter cannot establish full coverage', () => {
  const config = { DealerId: 123, PageId: 30, PageVehicleType: 'All', BaseFilter: 'year >= 2025' };
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ set innerHTML(_value) {}, content: { querySelector: selector => selector === '#dlron-srp-model' ? { textContent: JSON.stringify(config) } : null, querySelectorAll: () => [] } }) };
  try {
    const result = parseInventoryHtml('', { url: `${site}inventory`, kind: 'html' }, site, 100);
    assert.equal(result.tasks[0].condition, 'all');
    assert.equal(result.tasks[0].fullScope, false);
    assert.equal(result.tasks[0].config.BaseFilter, config.BaseFilter);
  } finally { globalThis.document = previous; }
});

test('different location listing URLs sharing a VIN still reconcile', async () => {
  const first = `${site}page1`, second = `${site}page2`;
  const fixture = worker({ queue: [first, second].map(url => ({ url, kind: 'html' })), parsed: { [first]: pageResult([vehicle('A', '/location/1')], false), [second]: pageResult([vehicle('A', '/location/2')], true) } });
  await fixture.api.processBatch();
  assert.equal(fixture.saved().status, 'ready');
  assert.equal(fixture.saved().vehicles.find(v => v.id === 'B').listed, false);
});

test('narrow scope imports observations without unlisting cached vehicles', async () => {
  const fixture = worker({ queue: [{ url: site, kind: 'html' }], parsed: { [site]: { ...pageResult([vehicle('A')], true), expected: 1, fullScope: false } } });
  await fixture.api.processBatch();
  assert.equal(fixture.saved().status, 'partial');
  assert.equal(fixture.saved().lastCompletedAt, 123);
  assert.equal(fixture.saved().vehicles.find(v => v.id === 'B').listed, true);
});

test('DealerOn full scope accepts only proven filter shapes and rechecks persisted tasks', () => {
  for (const [filter, condition, complete] of [['', 'all', true], ["type='n'", 'new', true], ["type='u'", 'used', true], ["type='u' AND year >= 2025", 'used', false], ["type='n'", 'all', false], ["type='u'", 'new', false], ['year >= 2025', 'all', false], ["type='c'", 'used', false]]) {
    const config = { DealerId: 123, PageId: 30, BaseFilter: filter };
    assert.equal(dealerOnFullScope(config, condition), complete);
    const result = parseDealerOn({ DisplayCards: [], Paging: { PaginationDataModel: { PageNumber: 1, TotalPages: 0, TotalCount: 0 } } }, { config, condition, page: 1, url: site, fullScope: true }, site, 100);
    assert.equal(result.fullScope, complete);
  }
});

for (const status of [429, 503]) {
  for (const header of ['120', new Date(1_800_000_120_000).toUTCString()]) {
    test(`${status} Retry-After ${header} persists task and wait across worker restart`, async () => {
      const url = `${site}retry`, next = `${site}next`;
      const fixture = worker({ queue: [url, next].map(url => ({ url, kind: 'html' })), pages: { [url]: { status, headers: { 'Retry-After': header } } } });
      await fixture.api.processBatch();
      assert.deepEqual(fixture.requests.map(r => r.url), [url]);
      const paused = fixture.saved();
      assert.equal(paused.job.queue[0].retries, 1);
      assert.equal(paused.job.originWaits[new URL(site).origin], 1_800_000_120_000);
      assert.equal(fixture.alarms.get(model.WORK_ALARM).when, 1_800_000_120_000);
      const resumed = worker({ state: paused, parsed: { [url]: { ...pageResult([vehicle('A')], true), expected: 1 }, [next]: { ...pageResult([vehicle('B')], true), group: 'other', expected: 1 } } });
      resumed.advance(119_000);
      // Short waits are allowed inline, but never request early.
      await resumed.api.processBatch();
      assert.ok(resumed.requests.every(r => r.at >= 1_800_000_120_000));
      assert.equal(resumed.saved().status, 'ready');
    });
  }
}

test('retry exhaustion is bounded and still delays the next same-origin task', async () => {
  const url = `${site}retry`, next = `${site}next`;
  let fixture = worker({ queue: [url, next].map(url => ({ url, kind: 'html' })), pages: { [url]: { status: 429, headers: { 'Retry-After': '120' } } } });
  for (let attempt = 0; attempt < 3; attempt++) {
    await fixture.api.processBatch();
    assert.equal(fixture.requests.length, 1);
    const state = fixture.saved();
    if (attempt < 2) {
      assert.equal(state.job.queue[0].retries, attempt + 1);
      fixture = worker({ state, pages: { [url]: { status: 429, headers: { 'Retry-After': '120' } } }, parsed: { [next]: { ...pageResult([vehicle('A')], true), expected: 1 } } });
      fixture.advance((attempt + 1) * 120_000);
    } else {
      assert.equal(state.job.queue[0].url, next);
      fixture.advance(120_000);
      await fixture.api.processBatch();
      assert.equal(fixture.saved().status, 'partial');
      assert.match(fixture.saved().error, /429/);
      assert.equal(fixture.saved().lastCompletedAt, 123);
    }
  }
});

test('unusable Retry-After uses a conservative fallback and robots retries remain queued', async () => {
  for (const header of [undefined, '-1', 'tomorrow', '1.5']) {
    const fixture = worker({ queue: [{ url: site, kind: 'robots' }, { url: site, kind: 'html' }], pages: { [`${site}robots.txt`]: { status: 503, headers: header === undefined ? {} : { 'Retry-After': header } } } });
    await fixture.api.processBatch();
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.saved().job.queue[0].kind, 'robots');
    assert.equal(fixture.saved().job.queue[0].retries, 1);
    assert.equal(fixture.saved().requestWaits[new URL(site).origin], 1_800_000_060_000);
  }
});

test('long Retry-After stops within job bound and persists origin wait for manual refresh', async () => {
  const fixture = worker({ queue: [{ url: site, kind: 'html' }], pages: { [site]: { status: 503, headers: { 'Retry-After': '90000' } } } });
  await fixture.api.processBatch();
  const state = fixture.saved();
  assert.equal(state.job, null);
  assert.equal(state.lastCompletedAt, 123);
  assert.match(state.error, /one-day refresh limit/);
  const resumed = worker({ state });
  await resumed.api.command({ action: 'refresh' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumed.requests.length, 0);
});

for (const delay of [120, 90000]) {
  test(`Crawl-delay ${delay} is never shortened`, async () => {
    const fixture = worker({ queue: [{ url: site, kind: 'robots' }, { url: site, kind: 'html' }], pages: { [`${site}robots.txt`]: { body: `User-agent: *\nCrawl-delay: ${delay}` } } });
    await fixture.api.processBatch();
    assert.equal(fixture.requests.length, 1);
    const state = fixture.saved();
    if (delay === 120) {
      assert.equal(state.job.nextRequestAt, 1_800_000_120_000);
      assert.equal(state.job.policies[new URL(site).origin].delay, delay);
      const resumed = worker({ state });
      await resumed.api.processBatch();
      assert.equal(resumed.requests.length, 0);
    } else {
      assert.equal(state.job, null);
      assert.match(state.error, /one-day refresh limit/);
    }
  });
}

test('robots redirects follow exact paths and delegate policy to initial origin', async () => {
  const www = 'https://www.dealer.example.com/policy';
  const fixture = worker({ queue: [{ url: site, kind: 'robots' }, { url: site, kind: 'html' }], pages: { [`${site}robots.txt`]: { status: 302, headers: { location: '/policy' } }, [`${site}policy`]: { status: 302, headers: { location: www } }, [www]: { body: 'User-agent: *\nDisallow: /' } } });
  await fixture.api.processBatch();
  assert.deepEqual(fixture.requests.map(r => r.url), [`${site}robots.txt`, `${site}policy`, www]);
  assert.ok(fixture.requests.every(r => r.options.redirect === 'manual'));
  assert.equal(fixture.saved().lastCompletedAt, 123);
  assert.match(fixture.saved().error, /excludes/);
});

for (const destination of ['http://dealer.example.com/policy', 'https://outside.example.com/policy', 'https://www.dealer.example.com/policy']) {
  test(`robots destination checked before requesting ${destination}`, async () => {
    const fixture = worker({ queue: [{ url: site, kind: 'robots' }, { url: site, kind: 'html' }], pages: { [`${site}robots.txt`]: { status: 302, headers: { location: destination } } }, permissions: origin => !origin.includes('www.') });
    await fixture.api.processBatch();
    assert.deepEqual(fixture.requests.map(r => r.url), [`${site}robots.txt`]);
    assert.equal(fixture.saved().job, null);
  });
}

test('robots loops and excessive hops stop without inventory requests', async () => {
  for (const loop of [true, false]) {
    const pages = { [`${site}robots.txt`]: { status: 302, headers: { location: '/hop1' } } };
    for (let i = 1; i <= 6; i++) pages[`${site}hop${i}`] = { status: 302, headers: { location: loop ? '/robots.txt' : `/hop${i + 1}` } };
    const fixture = worker({ queue: [{ url: site, kind: 'robots' }, { url: site, kind: 'html' }], pages });
    await fixture.api.processBatch();
    assert.equal(fixture.requests.length, loop ? 2 : 6);
    assert.match(fixture.saved().error, /redirect chain/);
    assert.equal(fixture.saved().lastCompletedAt, 123);
  }
});

test('redirect Retry-After blocks the redirected request even on a different allowed origin', async () => {
  const destination = 'https://www.dealer.example.com/policy';
  const fixture = worker({ queue: [{ url: site, kind: 'robots' }], pages: { [`${site}robots.txt`]: { status: 302, headers: { location: destination, 'Retry-After': '120' } } } });
  await fixture.api.processBatch();
  assert.equal(fixture.requests.length, 1);
  const resumed = worker({ state: fixture.saved(), pages: { [destination]: { body: 'User-agent: *\nAllow: /' } } });
  resumed.advance(120_000);
  await resumed.api.processBatch();
  assert.deepEqual(resumed.requests.map(r => r.url), [destination]);
  assert.ok(resumed.requests[0].at >= 1_800_000_120_000);
});

test('pre-upgrade persisted groups cannot bypass source-row or scope verification', async () => {
  for (const legacy of [{}, { rows: [JSON.stringify(['A', `${site}vehicle/A`])], fullScope: false }]) {
    const fixture = worker({ queue: [] });
    const state = fixture.saved();
    state.job.vehicles = [vehicle('A')];
    state.job.groups = { old: { ids: ['A'], acceptedRows: 1, expected: 1, finalPage: true, scope: 'all', ...legacy } };
    const resumed = worker({ state });
    await resumed.api.processBatch();
    assert.equal(resumed.saved().status, 'partial');
    assert.equal(resumed.saved().lastCompletedAt, 123);
    assert.equal(resumed.saved().vehicles.find(v => v.id === 'B').listed, true);
  }
});

test('verified empty all scope still reconciles absence', async () => {
  const fixture = worker({ queue: [{ url: site, kind: 'html' }], parsed: { [site]: { ...pageResult([], true), expected: 0, fullScope: true } } });
  await fixture.api.processBatch();
  assert.equal(fixture.saved().status, 'ready');
  assert.ok(fixture.saved().vehicles.every(v => !v.listed));
});

test('robots delegation can revisit a resource from an earlier independent origin read', async () => {
  const www = 'https://www.dealer.example.com/';
  const first = worker({ queue: [{ url: site, kind: 'robots' }, { url: www, kind: 'robots' }] });
  const state = first.saved();
  state.job.visited = [`${site}robots.txt`];
  state.job.queue = [{ url: www, kind: 'robots' }, { url: www, kind: 'html' }];
  const fixture = worker({ state, pages: { [`${www}robots.txt`]: { status: 302, headers: { location: `${site}robots.txt` } }, [`${site}robots.txt`]: { body: 'User-agent: *\nCrawl-delay: 120\nDisallow: /private' } } });
  await fixture.api.processBatch();
  assert.deepEqual(fixture.requests.map(r => r.url), [`${www}robots.txt`, `${site}robots.txt`]);
  assert.deepEqual(fixture.saved().job.policies[new URL(www).origin].rules, [{ allow: false, path: '/private' }]);
  assert.equal(fixture.saved().job.policies[new URL(www).origin].delay, 120);
});
