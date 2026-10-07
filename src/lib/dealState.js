import { CALCULATION_LIMITS, fromCents, normalizeApr, toCents } from './calculations.js';
import { todayDealDate } from './policy.js';

export const DEFAULT_APR_BY_TERM = Object.freeze({ 36: 6, 48: 6, 60: 6, 72: 6.5, 84: 7 });
const moneyFields = new Set(['salePrice', 'cashDown', 'tradeAllowance', 'tradePayoff', 'newPlateAmount']);

/** @typedef {{id:string, category:'service-contract'|'gap'|'other', name:string, amount:number, taxable:boolean, taxTreatmentConfirmed:boolean}} Product */
/** @typedef {{salePrice:number|null,cashDown:number,tradeAllowance:number,tradePayoff:number,newPlateAmount:number|null,apr:number,termMonths:number,dealDate:string,vehicleDescription:string,optionalItems:Product[]}} Deal */

const money = value => {
  const normalized = fromCents(toCents(value));
  if (normalized < 0 || normalized > CALCULATION_LIMITS.maxAmount) throw new RangeError('Amount outside supported range.');
  return normalized;
};

export function normalizeDealPatch(patch) {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    if (moneyFields.has(key)) {
      const unknown = (key === 'salePrice' || key === 'newPlateAmount') && (value === '' || value == null);
      return [key, unknown ? null : money(value)];
    }
    if (key === 'apr') return [key, normalizeApr(value)];
    return [key, value];
  }));
}

export function createDeskState(dealDate = todayDealDate()) {
  return {
    deal: { salePrice: null, cashDown: 0, tradeAllowance: 0, tradePayoff: 0,
      dealType: 'finance', plateMode: 'transfer', newPlateAmount: null,
      rollNegativeEquity: true, apr: 6.5, termMonths: 72, optionalItems: [],
      dealDate, vehicleDescription: '' },
    gridRates: { ...DEFAULT_APR_BY_TERM }, gridDownPayments: [0, 1000, 2000, 3000],
    view: 'dealer', mobileGridOpen: false, lastRoll: null, nextItemId: 1, resetCount: 0,
    // The day this desk was started. Edits are measured against a blank desk from
    // that day, so passing midnight never makes an untouched desk look edited.
    startDate: dealDate,
    // Set once someone picks the estimate date; the desk then keeps it until Reset.
    dateChosen: false,
  };
}

export function hasDealEdits(state) {
  const baseline = createDeskState(state.startDate);
  return JSON.stringify(state.deal) !== JSON.stringify(baseline.deal)
    || JSON.stringify(state.gridRates) !== JSON.stringify(baseline.gridRates)
    || JSON.stringify(state.gridDownPayments) !== JSON.stringify(baseline.gridDownPayments);
}

function withPatch(state, patch, label) {
  const normalized = normalizeDealPatch(patch);
  const deal = { ...state.deal, ...normalized };
  const gridRates = normalized.apr !== undefined ? { ...state.gridRates, [deal.termMonths]: deal.apr } : state.gridRates;
  return { ...state, deal, gridRates, lastRoll: label ? { deal: state.deal, gridRates: state.gridRates, label } : null };
}

/** Every mutation passes here. An undo expires as soon as a subsequent edit occurs. */
export function deskReducer(state, action) {
  switch (action.type) {
    case 'field': {
      if (action.field === 'dealDate') return { ...withPatch(state, { dealDate: action.value }), dateChosen: true };
      const patch = { [action.field]: action.value };
      if (action.field === 'termMonths') patch.apr = state.gridRates[action.value] ?? state.deal.apr;
      if (action.field === 'dealType' && action.value === 'cash') patch.cashDown = 0;
      return { ...withPatch(state, patch), mobileGridOpen: action.field === 'dealType' ? false : state.mobileGridOpen };
    }
    case 'apply': return withPatch(state, action.patch, action.label);
    case 'grid': return { ...withPatch(state, action.patch), mobileGridOpen: false };
    case 'rate': {
      const rate = normalizeApr(action.value);
      const next = { ...state, gridRates: { ...state.gridRates, [action.term]: rate }, lastRoll: null };
      return action.term === state.deal.termMonths ? { ...next, deal: { ...state.deal, apr: rate } } : next;
    }
    case 'down': return { ...state, lastRoll: null, gridDownPayments: state.gridDownPayments.map((v, i) => i === action.index ? money(action.value) : v) };
    case 'add-item': {
      if (state.deal.optionalItems.length >= CALCULATION_LIMITS.maxOptionalItems) return state;
      const item = { id: `add-on-${state.nextItemId}`, category: 'service-contract', name: 'Service Contract', amount: 0, taxable: false, taxTreatmentConfirmed: true, ...action.preset };
      if (item.category === 'other' && action.preset?.taxTreatmentConfirmed !== true) item.taxTreatmentConfirmed = false;
      item.amount = money(item.amount);
      return { ...state, nextItemId: state.nextItemId + 1,
        deal: { ...state.deal, optionalItems: [...state.deal.optionalItems, item] },
        lastRoll: action.label ? { deal: state.deal, gridRates: state.gridRates, label: action.label } : null };
    }
    case 'item': {
      const patch = { ...action.patch };
      if ('amount' in patch) patch.amount = money(patch.amount);
      return { ...state, deal: { ...state.deal, optionalItems: state.deal.optionalItems.map((item, index) => index === action.index ? { ...item, ...patch } : item) },
        lastRoll: action.label ? { deal: state.deal, gridRates: state.gridRates, label: action.label } : null };
    }
    case 'remove-item': return { ...state, lastRoll: null, deal: { ...state.deal, optionalItems: state.deal.optionalItems.filter((_, index) => index !== action.index) } };
    case 'undo': return state.lastRoll ? { ...state, deal: state.lastRoll.deal, gridRates: state.lastRoll.gridRates, lastRoll: null } : state;
    case 'view': return { ...state, view: action.view, mobileGridOpen: false };
    case 'grid-visibility': return { ...state, mobileGridOpen: action.open && state.view === 'dealer' && state.deal.dealType === 'finance' };
    case 'reset': return { ...createDeskState(), resetCount: state.resetCount + 1 };
    // A blank desk left open past midnight moves to the new day, as a fresh page would.
    // Only forward, because Reset can already be on the new day while the app's clock
    // still says yesterday. A desk with edits, or a date someone picked, keeps its date.
    // Only the date changes, so nothing remounts under someone who is typing.
    case 'new-day': return action.date <= state.startDate || state.dateChosen || hasDealEdits(state) ? state
      : { ...state, startDate: action.date, deal: { ...state.deal, dealDate: action.date }, lastRoll: null };
    default: return state;
  }
}
