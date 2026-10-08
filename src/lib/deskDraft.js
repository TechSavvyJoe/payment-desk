import { CALCULATION_LIMITS, RATE_GRID_DEFAULTS } from './calculations.js';
import { createDeskState, hasDealEdits } from './dealState.js';
import { parseShortDate } from './formatters.js';
import { parseFinancialInput } from './inputValidation.js';
import { isRegistrationState, isTransactionScope } from './purchaseScope.js';

export const LEGACY_DESK_DRAFT_KEY = 'payment-desk.draft.v1';
export const DESK_DRAFT_KEY = 'payment-desk.draft.v2';
// Share the released writer's lock while reading a legacy snapshot.
export const DESK_DRAFT_LOCK_KEY = LEGACY_DESK_DRAFT_KEY;
const terms = RATE_GRID_DEFAULTS.termMonths;
const targets = ['payment', 'outTheDoor', 'amountFinanced', 'cashDue'];
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= CALCULATION_LIMITS.maxAmount && Math.abs(value * 100 - Math.round(value * 100)) < .00001;
const rate = value => money(value) && value <= CALCULATION_LIMITS.maxApr;
const date = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const fieldId = /^(?:sale-price|cash-down|trade-allowance|trade-payoff|apr|new-plate-amount|target-value|estimate-date|grid-down-[0-3]|grid-apr-(?:36|48|60|72|84)|product-add-on-\d+-amount)$/;
export const isDeskDraftField = id => fieldId.test(id);
const storageOnDevice = () => { try { return window.localStorage; } catch { return null; } };
const locksOnDevice = () => { try { return navigator.locks; } catch { return null; } };

export function isBaselineDeskInput(id, raw, startDate) {
  if (!isDeskDraftField(id) || id === 'estimate-date' || id.startsWith('product-')) return false;
  const kind = id === 'apr' || id.startsWith('grid-apr-') ? 'rate' : 'money';
  // A trailing decimal is still being typed, even when its parsed value is zero.
  if (/\.$/.test(raw.trim().replace(/%$/, '').trim())) return false;
  const parsed = parseFinancialInput(raw, { kind, required: kind === 'rate' || id === 'new-plate-amount' });
  if (parsed.error) return false;
  if (id === 'target-value') return parsed.value === '';
  const baseline = createDeskState(startDate);
  const fields = { 'sale-price': 'salePrice', 'cash-down': 'cashDown', 'trade-allowance': 'tradeAllowance', 'trade-payoff': 'tradePayoff', apr: 'apr', 'new-plate-amount': 'newPlateAmount' };
  const value = parsed.value === '' ? (id === 'sale-price' ? null : 0) : parsed.value;
  if (id.startsWith('grid-down-')) return value === baseline.gridDownPayments[Number(id.slice(10))];
  if (id.startsWith('grid-apr-')) return value === baseline.gridRates[Number(id.slice(9))];
  return value === baseline.deal[fields[id]];
}

export function normalizeDeskDraft(value) {
  try {
    if (![1, 2].includes(value?.version) || !value.desk || !value.targetValues || !value.inputDrafts) return null;
    const source = value.desk;
    const deal = source.deal;
    const registrationState = value.version === 1 && deal?.registrationState === undefined ? 'MI' : deal.registrationState;
    const transactionScope = value.version === 1 && deal?.transactionScope === undefined ? 'resident-retail' : deal.transactionScope;
    if (!deal || !date(deal.dealDate) || !date(source.startDate)
      || !isRegistrationState(registrationState) || !isTransactionScope(transactionScope)
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
      || source.gridRates[deal.termMonths] !== deal.apr
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
      if (isBaselineDeskInput(id, draft.raw, source.startDate)) continue;
      // Preserve unfinished/invalid typing, but a valid restored date must agree
      // with the committed date used in calculations and customer proposals.
      if (id === 'estimate-date') {
        const parsed = parseShortDate(draft.raw);
        if (parsed.value && parsed.value !== deal.dealDate) continue;
      }
      inputDrafts[id] = { raw: draft.raw };
    }
    const desk = createDeskState(source.startDate);
    desk.deal = Object.fromEntries(Object.keys(desk.deal).map(key => [key, key === 'optionalItems' ? optionalItems
      : key === 'registrationState' ? registrationState : key === 'transactionScope' ? transactionScope : deal[key]]));
    desk.gridRates = Object.fromEntries(terms.map(term => [term, source.gridRates[term]]));
    desk.gridDownPayments = [...source.gridDownPayments];
    desk.dateChosen = source.dateChosen;
    desk.nextItemId = source.nextItemId;
    return { version: 2, desk, targetType: value.targetType, targetValues: Object.fromEntries(targets.map(type => [type, value.targetValues[type]])), inputDrafts };
  } catch { return null; }
}

function classifyRecord(raw, key) {
  const record = { kind: 'absent', draft: null, raw, key, reason: null };
  if (raw === null) return record;
  const reject = reason => ({ ...record, kind: 'rejected', reason });
  if (raw.length > 200_000) return reject('oversized');
  let value;
  try { value = JSON.parse(raw); } catch { return reject('malformed-json'); }
  if (value?.version !== (key === DESK_DRAFT_KEY ? 2 : 1)) return reject('unsupported-version');
  if (key === DESK_DRAFT_KEY && value.discarded === true) {
    return typeof value.revision === 'string' && value.revision.length > 0 && value.revision.length <= 100
      && Object.keys(value).every(key => ['version', 'discarded', 'revision'].includes(key))
      ? record : reject('invalid-fields');
  }
  const draft = normalizeDeskDraft(value);
  return draft ? { ...record, kind: 'valid', draft } : reject('invalid-fields');
}

export function readDeskDraftRecord(storage = storageOnDevice()) {
  try {
    if (!storage) throw new Error('Storage unavailable');
    const raw = storage.getItem(DESK_DRAFT_KEY);
    // Even a rejected or discarded v2 record suppresses legacy fallback.
    return raw !== null ? classifyRecord(raw, DESK_DRAFT_KEY)
      : classifyRecord(storage.getItem(LEGACY_DESK_DRAFT_KEY), LEGACY_DESK_DRAFT_KEY);
  } catch {
    return { kind: 'unreadable', draft: null, raw: null, key: null, reason: 'unavailable' };
  }
}

export function loadDeskDraft(storage = storageOnDevice()) {
  return readDeskDraftRecord(storage).draft;
}

export function hasDeskDraftEdits({ desk, targetValues, inputDrafts }) {
  return hasDealEdits(desk) || desk.dateChosen || targets.some(type => targetValues[type] !== '')
    || Object.entries(inputDrafts).some(([id, draft]) => !isBaselineDeskInput(id, draft.raw, desk.startDate));
}

function writeDeskDraft(value, storage, record, discard = false) {
  const draft = discard ? null : normalizeDeskDraft({ ...value, version: 2 });
  if (!storage || (!discard && !draft)) return { ok: false };
  try {
    if (discard || !hasDeskDraftEdits(draft)) {
      // Retain v1 bytes for recovery, but never resurrect them after a reset.
      // A unique revision also prevents a reset/save/reset ABA across tabs.
      if (discard || record.kind !== 'absent') storage.setItem(DESK_DRAFT_KEY,
        JSON.stringify({ version: 2, discarded: true, revision: crypto.randomUUID() }));
    } else {
      const raw = JSON.stringify(draft);
      if (raw.length > 200_000) return { ok: false };
      storage.setItem(DESK_DRAFT_KEY, raw);
    }
    return { ok: true };
  } catch { return { ok: false }; }
}

export function saveDeskDraft(value, storage = storageOnDevice()) {
  const record = readDeskDraftRecord(storage);
  if (record.kind === 'rejected') return { ok: false, rejected: true, reason: record.reason };
  if (record.kind === 'unreadable') return { ok: false };
  return writeDeskDraft(value, storage, record);
}

// Compare exact bytes under the same lock used by released v1 tabs. Once v2
// exists, old writers may update v1 but can never replace the current worksheet.
export function createDeskDraftSession(storage = storageOnDevice(), locks = locksOnDevice()) {
  let record = readDeskDraftRecord(storage), conflicted = false, cleanupFailed = false;
  let legacyExpected = record.key === LEGACY_DESK_DRAFT_KEY ? record.raw : null, legacyUnreadable = false;
  if (record.key === DESK_DRAFT_KEY) {
    try { legacyExpected = storage.getItem(LEGACY_DESK_DRAFT_KEY); } catch { legacyUnreadable = true; }
  }
  const draft = record.draft;
  const checkStatus = () => {
    if (conflicted) return 'conflict';
    if (record.kind === 'unreadable') return 'error';
    const current = readDeskDraftRecord(storage);
    if (current.kind === 'unreadable') { record = current; return 'error'; }
    if (current.key !== record.key || current.raw !== record.raw) { conflicted = true; return 'conflict'; }
    return record.kind === 'rejected' ? 'rejected' : 'saved';
  };
  const mutate = async (value, discard) => {
    if (!locks?.request) return { ok: false };
    try {
      return await locks.request(DESK_DRAFT_LOCK_KEY, () => {
        const current = checkStatus();
        if (current === 'rejected' && !discard) return { ok: false, rejected: true, reason: record.reason };
        if (current !== 'saved' && !(discard && current === 'rejected')) return { ok: false, conflict: current === 'conflict' };
        if (!discard && cleanupFailed) return { ok: false, reason: 'legacy-removal-failed' };
        if (discard) {
          if (legacyUnreadable) return { ok: false, reason: 'legacy-unreadable' };
          try {
            if (storage.getItem(LEGACY_DESK_DRAFT_KEY) !== legacyExpected) {
              conflicted = true; return { ok: false, conflict: true };
            }
          } catch { legacyUnreadable = true; return { ok: false, reason: 'legacy-unreadable' }; }
        }
        const outcome = writeDeskDraft(value, storage, record, discard);
        if (outcome.ok) {
          record = readDeskDraftRecord(storage);
          if (record.kind === 'unreadable') return { ok: false };
          if (discard) {
            // Only explicit cleanup removes legacy figures. Blank autosave must
            // not erase a separate old-version worksheet behind valid v2 data.
            try {
              if (legacyExpected !== null) storage.removeItem(LEGACY_DESK_DRAFT_KEY);
              if (storage.getItem(LEGACY_DESK_DRAFT_KEY) !== null) throw new Error('Legacy draft remains');
              legacyExpected = null; cleanupFailed = false;
            } catch {
              cleanupFailed = true;
              return { ok: false, reason: 'legacy-removal-failed' };
            }
          }
        }
        return outcome;
      });
    } catch { return { ok: false }; }
  };
  return {
    draft,
    status: () => { const current = checkStatus(); return current === 'saved' && cleanupFailed ? 'error' : current; },
    get record() { return record; },
    save: value => mutate(value, false),
    discard: () => mutate(null, true),
  };
}
