import { CALCULATION_LIMITS, RATE_GRID_DEFAULTS } from './calculations.js';
import { createDeskState, hasDealEdits } from './dealState.js';

export const DESK_DRAFT_KEY = 'payment-desk.draft.v1';
const terms = RATE_GRID_DEFAULTS.termMonths;
const targets = ['payment', 'outTheDoor', 'amountFinanced', 'cashDue'];
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= CALCULATION_LIMITS.maxAmount && Math.abs(value * 100 - Math.round(value * 100)) < .00001;
const rate = value => money(value) && value <= CALCULATION_LIMITS.maxApr;
const date = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const fieldId = /^(?:sale-price|cash-down|trade-allowance|trade-payoff|apr|new-plate-amount|target-value|estimate-date|grid-down-[0-3]|grid-apr-(?:36|48|60|72|84)|product-add-on-\d+-amount)$/;
export const isDeskDraftField = id => fieldId.test(id);
const storageOnDevice = () => { try { return window.localStorage; } catch { return null; } };
const locksOnDevice = () => { try { return navigator.locks; } catch { return null; } };

export function normalizeDeskDraft(value) {
  try {
    if (value?.version !== 1 || !value.desk || !value.targetValues || !value.inputDrafts) return null;
    const source = value.desk;
    const deal = source.deal;
    if (!deal || !date(deal.dealDate) || !date(source.startDate)
      || !['finance', 'cash'].includes(deal.dealType) || !['transfer', 'new'].includes(deal.plateMode)
      || typeof deal.rollNegativeEquity !== 'boolean' || typeof source.dateChosen !== 'boolean'
      || !terms.includes(deal.termMonths) || !rate(deal.apr)
      || typeof deal.vehicleDescription !== 'string' || deal.vehicleDescription.length > 100
      || !Array.isArray(deal.optionalItems) || deal.optionalItems.length > CALCULATION_LIMITS.maxOptionalItems) return null;
    for (const key of ['salePrice', 'cashDown', 'tradeAllowance', 'tradePayoff', 'newPlateAmount']) {
      if (!(deal[key] === null && ['salePrice', 'newPlateAmount'].includes(key)) && !money(deal[key])) return null;
    }
    const ids = new Set();
    const optionalItems = [];
    for (const item of deal.optionalItems) {
      if (!item || !/^add-on-[1-9]\d{0,8}$/.test(item.id) || ids.has(item.id)
        || !['service-contract', 'gap', 'other'].includes(item.category)
        || typeof item.name !== 'string' || item.name.length > 120 || !money(item.amount)
        || typeof item.taxable !== 'boolean' || typeof item.taxTreatmentConfirmed !== 'boolean') return null;
      ids.add(item.id);
      optionalItems.push({ id: item.id, category: item.category, name: item.name, amount: item.amount, taxable: item.taxable, taxTreatmentConfirmed: item.taxTreatmentConfirmed });
    }
    if (!Array.isArray(source.gridDownPayments) || source.gridDownPayments.length !== 4 || !source.gridDownPayments.every(money)
      || !terms.every(term => rate(source.gridRates?.[term])) || !targets.includes(value.targetType)
      || !Number.isSafeInteger(source.nextItemId) || source.nextItemId < 1 || source.nextItemId > 1_000_000_000
      || source.nextItemId <= Math.max(0, ...optionalItems.map(item => Number(item.id.slice(7))))
      || (deal.dealType === 'cash' ? !['cashDue', 'outTheDoor'].includes(value.targetType) : value.targetType === 'cashDue')
      || !targets.every(type => value.targetValues[type] === '' || money(value.targetValues[type]))) return null;
    const inputDrafts = {};
    const entries = Object.entries(value.inputDrafts);
    if (entries.length > 100) return null;
    for (const [id, draft] of entries) {
      if (!fieldId.test(id) || typeof draft?.raw !== 'string' || draft.raw.length > 1000) return null;
      if (id.startsWith('product-') && !ids.has(id.slice(8, -7))) continue;
      inputDrafts[id] = { raw: draft.raw };
    }
    const desk = createDeskState(source.startDate);
    desk.deal = Object.fromEntries(Object.keys(desk.deal).map(key => [key, key === 'optionalItems' ? optionalItems : deal[key]]));
    desk.gridRates = Object.fromEntries(terms.map(term => [term, source.gridRates[term]]));
    desk.gridDownPayments = [...source.gridDownPayments];
    desk.dateChosen = source.dateChosen;
    desk.nextItemId = source.nextItemId;
    return { version: 1, desk, targetType: value.targetType, targetValues: Object.fromEntries(targets.map(type => [type, value.targetValues[type]])), inputDrafts };
  } catch { return null; }
}

export function loadDeskDraft(storage = storageOnDevice()) {
  try {
    const raw = storage?.getItem(DESK_DRAFT_KEY);
    return raw && raw.length <= 200_000 ? normalizeDeskDraft(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function hasDeskDraftEdits({ desk, targetValues, inputDrafts }) {
  return hasDealEdits(desk) || desk.dateChosen || targets.some(type => targetValues[type] !== '') || Object.keys(inputDrafts).length > 0;
}

export function saveDeskDraft(value, storage = storageOnDevice()) {
  const draft = normalizeDeskDraft({ ...value, version: 1 });
  if (!storage || !draft) return { ok: false };
  try {
    const empty = !hasDeskDraftEdits(draft);
    if (empty) storage.removeItem(DESK_DRAFT_KEY);
    else {
      const raw = JSON.stringify(draft);
      if (raw.length > 200_000) return { ok: false };
      storage.setItem(DESK_DRAFT_KEY, raw);
    }
    return { ok: true };
  } catch { return { ok: false }; }
}

// One session remembers the exact draft it opened or last saved. The shared
// browser lock makes comparison and mutation a single operation across tabs.
// A stale session stays read-only until reload; Reset cannot erase newer work.
export function createDeskDraftSession(storage = storageOnDevice(), locks = locksOnDevice()) {
  let expected, unreadable = false, conflicted = false;
  try { expected = storage?.getItem(DESK_DRAFT_KEY) ?? null; }
  catch { unreadable = true; }
  let draft = null;
  try { if (expected && expected.length <= 200_000) draft = normalizeDeskDraft(JSON.parse(expected)); }
  catch { /* Invalid drafts open a blank worksheet. */ }
  const status = () => {
    if (conflicted) return 'conflict';
    if (!storage || unreadable) return 'error';
    try {
      if (storage.getItem(DESK_DRAFT_KEY) !== expected) { conflicted = true; return 'conflict'; }
      return 'saved';
    } catch { return 'error'; }
  };
  return {
    draft, status,
    async save(value) {
      // Without cross-tab locking, retain the previous draft rather than risk
      // replacing it. The app reports the existing save warning in that case.
      if (!locks?.request) return { ok: false };
      try {
        return await locks.request(DESK_DRAFT_KEY, () => {
          const current = status();
          if (current !== 'saved') return { ok: false, conflict: current === 'conflict' };
          const outcome = saveDeskDraft(value, storage);
          if (outcome.ok) expected = storage.getItem(DESK_DRAFT_KEY);
          return outcome;
        });
      } catch { return { ok: false }; }
    },
  };
}
