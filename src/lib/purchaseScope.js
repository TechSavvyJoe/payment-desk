// Coverage is an explicit product capability, not a guessed tax rate. National
// jurisdictions remain unavailable until a licensed automotive engine passes
// the release gate. Undefined fields preserve older Michigan-only worksheets.
export const REGISTRATION_STATES = Object.freeze(Object.entries({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}).map(([value, label]) => Object.freeze({ value, label })));

export const TRANSACTION_SCOPES = Object.freeze([
  { value: 'resident-retail', label: 'Taxable resident retail purchase' },
  { value: 'nonresident', label: 'Nonresident / out-of-state transaction' },
  { value: 'exempt', label: 'Tax-exempt transaction' },
  { value: 'manufacturer-rebate', label: 'Purchase with a manufacturer rebate' },
  { value: 'lease', label: 'Lease' },
  { value: 'special-registration', label: 'Commercial / special registration' },
].map(Object.freeze));

export const isRegistrationState = value => value === '' || REGISTRATION_STATES.some(state => state.value === value);
export const isTransactionScope = value => value === '' || TRANSACTION_SCOPES.some(scope => scope.value === value);

export function getPurchaseScope(input = {}) {
  const registrationState = input.registrationState === undefined ? 'MI' : input.registrationState;
  const transactionScope = input.transactionScope === undefined ? 'resident-retail' : input.transactionScope;
  let reason = '', errorField = '';
  if (registrationState !== 'MI') {
    errorField = 'registration-state';
    const name = REGISTRATION_STATES.find(state => state.value === registrationState)?.label;
    reason = name
      ? `${name} automatic tax and registration rules are not connected. This release supports Michigan resident purchases only. No estimate can be shared or printed for this state.`
      : 'Choose a supported buyer registration state before calculating an estimate. This release supports Michigan resident purchases only.';
  } else if (transactionScope !== 'resident-retail') {
    errorField = 'transaction-scope';
    reason = 'This transaction is outside the reviewed Michigan resident retail purchase rules. Use the dealership’s approved system for nonresident, exempt, rebate, lease or special-registration transactions.';
  }
  return { registrationState, transactionScope, supported: !reason, reason, errorField };
}

export class UnsupportedPurchaseError extends RangeError {
  constructor(scope) {
    super(scope.reason);
    this.name = 'UnsupportedPurchaseError';
    this.errorField = scope.errorField;
  }
}

export function assertSupportedPurchase(input) {
  const scope = getPurchaseScope(input);
  if (!scope.supported) throw new UnsupportedPurchaseError(scope);
  return scope;
}
