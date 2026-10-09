import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { calculateDeal } from './lib/calculations.js';
import { createDeskState, deskReducer, hasDealEdits } from './lib/dealState.js';
import { APP_VERSION, BUILD_ID } from './lib/release.js';
import { BRAND_STORAGE_KEY, loadBrandSettings, resolveBrand } from './lib/brandSettings.js';
import { FEE_STORAGE_KEY, loadFeeSettings, resolveFees } from './lib/feeSettings.js';
import { clearDeviceSettings, saveDeviceSettings } from './lib/deviceSettings.js';
import { policyReviewReminder, policyReviewReminderShort, todayDealDate } from './lib/policy.js';
import { getProposalStatus } from './lib/proposal.js';
import { formatShortDate, formatCurrency, formatNumber } from './lib/formatters.js';
import CustomerView from './components/CustomerView.jsx';
import DealerView from './components/DealerView.jsx';
import MobileNav from './components/MobileNav.jsx';
import PaymentGrid from './components/PaymentGrid.jsx';
import QuickJumpNav from './components/QuickJumpNav.jsx';
import ResultsPanel from './components/ResultsPanel.jsx';
import ViewToggle from './components/ViewToggle.jsx';
import { ValidationContext } from './components/ValidationContext.jsx';
import EstimateDateField from './components/EstimateDateField.jsx';
import DealershipSettingsDialog from './components/DealershipSettingsDialog.jsx';
import PolicyReminder from './components/PolicyReminder.jsx';
import VehicleImportDialog from './components/VehicleImportDialog.jsx';
import InventoryPicker from './components/InventoryPicker.jsx';
import { rememberCompanion } from './lib/companionInventory.js';
import { createDeskDraftSession, DESK_DRAFT_KEY, LEGACY_DESK_DRAFT_KEY, hasDeskDraftEdits, isBaselineDeskInput, isDeskDraftField } from './lib/deskDraft.js';
import { DraftContext } from './components/DraftContext.jsx';
import { REGISTRATION_STATES, TRANSACTION_SCOPES, UnsupportedPurchaseError, getPurchaseScope } from './lib/purchaseScope.js';
import { HANDOFF_PREFIX, parseVehicleHandoff } from '../extensions/payment-desk-companion/vehicleHandoff.js';

const allOpen = () => ({ vehicle: true, trade: true, taxes: true, roll: true });
const isMobile = () => window.matchMedia('(max-width: 800px)').matches;
const focusDestination = id => requestAnimationFrame(() => {
  const node = document.getElementById(id === 'worksheet-heading' && isMobile() ? 'calculator-top' : id);
  if (!node) return;
  node.focus({ preventScroll: true });
  node.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
});

// A desk left open overnight must pick up the new Eastern day on its own, so the
// December reminder appears and leaves on time. Phones pause timers in the
// background, so returning to the page checks the date straight away too.
function useEasternToday() {
  const [today, setToday] = useState(todayDealDate);
  useEffect(() => {
    const check = () => setToday(todayDealDate());
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return today;
}

export default function App({ restoreDraft = true, savedDraftSession }) {
  const [draftSession] = useState(() => savedDraftSession ?? createDeskDraftSession());
  const [restoredDraft] = useState(() => restoreDraft ? draftSession.draft : null);
  const [state, dispatch] = useReducer(deskReducer, undefined, () => restoredDraft?.desk ?? createDeskState());
  const [inputDrafts, setInputDrafts] = useState(() => restoredDraft?.inputDrafts ?? {});
  const [draftStatus, setDraftStatus] = useState(() => draftSession.status());
  const [settingsChanged, setSettingsChanged] = useState(false);
  const recoveryCleanupStarted = useRef(false);
  const draftSaved = draftStatus === 'saved';
  const rememberInput = useCallback((id, raw) => {
    if (!isDeskDraftField(id)) return;
    // Invalid typing is still an edit even when no new number can be committed.
    dispatch({ type: 'expire-undo' });
    setInputDrafts(current => {
      if (isBaselineDeskInput(id, raw, state.startDate)) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return current[id]?.raw === raw ? current : { ...current, [id]: { raw } };
    });
  }, [state.startDate]);
  const draftContext = useMemo(() => ({ values: inputDrafts, remember: rememberInput }), [inputDrafts, rememberInput]);
  const { deal, view, mobileGridOpen, gridRates, gridDownPayments, lastRoll, resetCount } = state;
  const [brandSettings, setBrandSettings] = useState(loadBrandSettings);
  const brand = useMemo(() => resolveBrand(brandSettings), [brandSettings]);
  // The dealership's fees live beside the deal, never in it, so Reset deal and
  // hasDealEdits ignore them. Every calculation reads them from this one dealInput.
  const [feeSettings, setFeeSettings] = useState(loadFeeSettings);
  const dealershipFees = useMemo(() => resolveFees(feeSettings), [feeSettings]);
  const dealInput = useMemo(() => ({ ...deal, dealershipFees }), [deal, dealershipFees]);
  const purchaseScope = getPurchaseScope(dealInput);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  useEffect(rememberCompanion, []);
  const [vehicleImport, setVehicleImport] = useState(() => parseVehicleHandoff(window.location.hash));
  useEffect(() => {
    const scrubFragment = () => {
      if (window.location.hash.startsWith(HANDOFF_PREFIX)) {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      }
    };
    const receiveVehicle = () => {
      if (!window.location.hash.startsWith(HANDOFF_PREFIX)) return;
      setVehicleImport(parseVehicleHandoff(window.location.hash));
      scrubFragment();
    };
    window.addEventListener('hashchange', receiveVehicle);
    // A side-panel capture can arrive between the first render and this effect.
    // Read it before clearing the fragment, as well as handling later captures.
    receiveVehicle();
    return () => window.removeEventListener('hashchange', receiveVehicle);
  }, []);
  const settingsButtonRef = useRef(null);
  // Even when the browser refuses to store them, the settings apply for this visit,
  // and the device keeps its previous saved settings whole.
  const applySettings = outcome => {
    setBrandSettings(outcome.brand);
    setFeeSettings(outcome.fees);
    return { ok: outcome.ok, persistence: outcome.persistence };
  };
  const saveSettings = (nextBrand, nextFees) => applySettings(saveDeviceSettings(nextBrand, nextFees));
  const clearSettings = () => applySettings(clearDeviceSettings());
  const closeSettings = () => { setSettingsOpen(false); requestAnimationFrame(() => settingsButtonRef.current?.focus()); };
  const [targetType, setTargetType] = useState(() => restoredDraft?.targetType ?? 'payment');
  const [targetInputRevision, setTargetInputRevision] = useState(0);
  const [targetValues, setTargetValues] = useState(() => ({ payment: '', outTheDoor: '', amountFinanced: '', cashDue: '', cashLimit: '', ...restoredDraft?.targetValues }));
  const [solverExpanded, setSolverExpanded] = useState(false);
  const [accordions, setAccordions] = useState(allOpen);
  const [contextOpen, setContextOpen] = useState(false);
  useEffect(() => {
    const changed = event => {
      if (event.key === null || event.key === BRAND_STORAGE_KEY || event.key === FEE_STORAGE_KEY) setSettingsChanged(true);
      if (event.key !== null && event.key !== DESK_DRAFT_KEY && event.key !== LEGACY_DESK_DRAFT_KEY) return;
      const status = draftSession.status();
      if (status !== 'saved') setDraftStatus(status);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [draftSession]);
  useEffect(() => {
    let current = true;
    // This status describes external storage work, not derived deal state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftStatus(status => ['conflict', 'rejected'].includes(status) ? status : 'saving');
    const save = async () => {
      if (!restoreDraft && !recoveryCleanupStarted.current) {
        recoveryCleanupStarted.current = true;
        const cleanup = await draftSession.discard();
        if (!cleanup.ok) return cleanup;
      }
      return draftSession.save({ desk: state, targetType, targetValues, inputDrafts });
    };
    void save().then(outcome => {
      if (!current) return;
      const status = draftSession.status();
      setDraftStatus(outcome.conflict || status === 'conflict' ? 'conflict' : outcome.rejected || status === 'rejected' ? 'rejected' : outcome.ok && status === 'saved' ? 'saved' : 'error');
    });
    return () => { current = false; };
  }, [draftSession, state, targetType, targetValues, inputDrafts, restoreDraft]);
  const [fieldErrors, setFieldErrors] = useState({});
  const targetInputRef = useRef(null);
  const reportError = useCallback((id, error) => setFieldErrors(current => {
    if ((current[id] ?? null) === error) return current;
    const next = { ...current };
    if (error) next[id] = error; else delete next[id];
    return next;
  }), []);
  const calculation = useMemo(() => {
    try { return { result: calculateDeal(dealInput), error: null }; }
    catch (failure) {
      const error = failure instanceof UnsupportedPurchaseError ? failure.message : 'These figures exceed the supported calculation range. Reduce the amounts before continuing.';
      const empty = calculateDeal({ ...createDeskState().deal, dealType: dealInput.dealType, dealershipFees });
      return { result: { ...empty, isComplete: false, incompleteReasons: [error] }, error, errorField: failure.errorField };
    }
  }, [dealInput, dealershipFees]);
  const result = calculation.result;
  const hasInputErrors = Object.keys(fieldErrors).length > 0 || Boolean(calculation.error) || settingsChanged;
  const hasDeal = hasDealEdits(state) || hasInputErrors;
  const hasDraftEdits = hasDeal || hasDeskDraftEdits({ desk: state, targetValues, inputDrafts });
  // A blank reset still needs confirmation that the old stored draft was removed.
  const needsDraftConfirmation = hasDraftEdits || resetCount > 0 || !restoreDraft;
  const canCompare = getProposalStatus({ dealInput, result, hasInputErrors }).canExport;
  const today = useEasternToday();

  useEffect(() => {
    if (!hasDeal) dispatch({ type: 'new-day', date: today });
  }, [hasDeal, today]);

  useEffect(() => {
    if (!needsDraftConfirmation || draftSaved) return;
    const warnBeforeLeaving = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [needsDraftConfirmation, draftSaved]);

  const focusFirstError = () => {
    setAccordions(allOpen());
    const errorId = settingsChanged ? 'settings-changed' : Object.keys(fieldErrors)[0] || calculation.errorField;
    const field = document.getElementById(errorId);
    if (field?.closest('.deal-details')) setContextOpen(true);
    if (isMobile()) dispatch({ type: 'grid-visibility', open: Boolean(field?.closest('#payment-grid')) });
    requestAnimationFrame(() => {
      const destination = document.getElementById(errorId);
      destination?.focus();
      destination?.scrollIntoView({ block: 'center' });
    });
  };
  const repairEstimate = fieldId => {
    const destinationId = fieldId === 'first-error'
      ? settingsChanged ? 'settings-changed' : Object.keys(fieldErrors)[0] || calculation.errorField || 'sale-price'
      : fieldId;
    dispatch({ type: 'view', view: 'dealer' });
    setAccordions(allOpen());
    if (['registration-state', 'transaction-scope', 'estimate-date'].includes(destinationId)) setContextOpen(true);
    if (/^grid-(apr|down)-/.test(destinationId) && isMobile()) dispatch({ type: 'grid-visibility', open: true });
    requestAnimationFrame(() => {
      const destination = document.getElementById(destinationId);
      destination?.focus({ preventScroll: true });
      destination?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  };
  const clearTargetDraft = () => {
    setInputDrafts(current => { const updated = { ...current }; delete updated['target-value']; return updated; });
    setFieldErrors(current => { const updated = { ...current }; delete updated['target-value']; return updated; });
  };
  const changeTargetType = next => {
    if (next === targetType) return;
    clearTargetDraft();
    setTargetType(next);
  };
  const updateField = (field, value) => {
    if (field === 'dealType') changeTargetType(value === 'cash' ? 'cashDue' : 'payment');
    dispatch({ type: 'field', field, value, undoTargetType: targetType,
      label: field === 'dealType' && value === 'cash' && deal.cashDown > 0 ? 'Cash purchase (financing down cleared)' : undefined });
  };
  const undoAdjustment = () => {
    if (!lastRoll) return;
    if (lastRoll.targetType) changeTargetType(lastRoll.targetType);
    else if (lastRoll.deal.dealType === 'cash' && targetType !== 'cashDue' && targetType !== 'outTheDoor') changeTargetType('cashDue');
    else if (lastRoll.deal.dealType === 'finance' && targetType === 'cashDue') changeTargetType('payment');
    dispatch({ type: 'undo' });
  };
  const changeView = next => {
    if (hasInputErrors) { focusFirstError(); return; }
    dispatch({ type: 'view', view: next });
    focusDestination(next === 'customer' ? 'customer-heading' : 'worksheet-heading');
  };
  const closeGrid = () => {
    dispatch({ type: 'grid-visibility', open: false });
    focusDestination('worksheet-heading');
  };
  const scrollToGrid = () => {
    if (hasInputErrors) { focusFirstError(); return; }
    if (isMobile()) dispatch({ type: 'grid-visibility', open: true });
    focusDestination('payment-grid-heading');
  };
  const adjustCustomerOptions = () => {
    if (hasInputErrors) { repairEstimate('first-error'); return; }
    dispatch({ type: 'view', view: 'dealer' });
    if (isMobile()) dispatch({ type: 'grid-visibility', open: true });
    focusDestination('payment-grid-heading');
  };
  const clearDeal = () => {
    setDraftStatus(status => status === 'conflict' ? status : 'saving');
    dispatch({ type: 'reset' });
    setInputDrafts({});
    setTargetType('payment'); setTargetValues({ payment: '', outTheDoor: '', amountFinanced: '', cashDue: '', cashLimit: '' });
    setSolverExpanded(false); setAccordions(allOpen()); setFieldErrors({}); setContextOpen(false);
  };
  const resetDeal = () => {
    if (hasDraftEdits && !window.confirm('Reset this deal? All figures, trade, products, targets and the selected date will be cleared.')) return;
    const cleanup = draftSession.discard();
    clearDeal();
    void cleanup.then(outcome => { if (!outcome.ok) setDraftStatus(outcome.conflict ? 'conflict' : 'error'); });
    focusDestination('worksheet-heading');
  };
  const closeVehicleImport = () => { setVehicleImport({ vehicle: null, error: null }); focusDestination('sale-price'); };
  const discardRejectedDraft = async () => {
    if (!window.confirm('Discard the unreadable saved worksheet? This cannot be undone. Figures in the currently open worksheet will be kept.')) return;
    setDraftStatus('saving');
    const discarded = await draftSession.discard();
    const outcome = discarded.ok ? await draftSession.save({ desk: state, targetType, targetValues, inputDrafts }) : discarded;
    setDraftStatus(outcome.conflict ? 'conflict' : outcome.ok ? 'saved' : draftSession.status() === 'rejected' ? 'rejected' : 'error');
  };
  const acceptVehicle = vehicle => {
    clearDeal();
    dispatch({ type: 'apply', patch: { salePrice: vehicle.salePrice, vehicleDescription: vehicle.vehicleDescription } });
    setContextOpen(Boolean(vehicle.vehicleDescription));
    closeVehicleImport();
  };
  const activatePaymentTarget = value => {
    const switchingType = targetType !== 'payment';
    const invalidExisting = !switchingType && Boolean(fieldErrors['target-value']);
    const needsSeed = targetValues.payment === '' && !invalidExisting;
    if (switchingType || needsSeed) clearTargetDraft();
    setTargetType('payment');
    if (needsSeed) setTargetValues(current => ({ ...current, payment: value }));
    if (switchingType || needsSeed) setTargetInputRevision(current => current + 1);
    requestAnimationFrame(() => {
      targetInputRef.current?.focus();
      targetInputRef.current?.select();
      targetInputRef.current?.scrollIntoView({ block: 'center' });
    });
  };
  const targetProps = {
    targetType, targetValues, gridRates, lastRoll, targetInputRef, targetInputRevision, hasInputErrors, canCompare,
    onTargetTypeChange: changeTargetType,
    onTargetValueChange: (type, value) => setTargetValues(current => ({ ...current, [type]: value })),
    cashLimit: targetValues.cashLimit,
    onCashLimitChange: value => setTargetValues(current => ({ ...current, cashLimit: value })),
    onClearCashLimit: () => {
      setTargetValues(current => ({ ...current, cashLimit: '' }));
      setInputDrafts(current => { const next = { ...current }; delete next['budget-cash-limit']; return next; });
      setFieldErrors(current => { const next = { ...current }; delete next['budget-cash-limit']; return next; });
    },
    expanded: solverExpanded, onExpandedChange: setSolverExpanded,
    onApplyPatch: (patch, label) => dispatch({ type: 'apply', patch, label }),
    onApplyItemPatch: ({ index, amount }, label) => dispatch({ type: 'item', index, patch: { amount }, label }),
    onAddRoomItem: (amount, label) => {
      dispatch({ type: 'add-item', preset: { category: 'other', name: '', amount, taxable: false, taxTreatmentConfirmed: false }, label });
      setAccordions(current => ({ ...current, roll: true }));
      requestAnimationFrame(() => {
        const names = document.querySelectorAll('[aria-label^="Product name for add-on"]');
        names[names.length - 1]?.focus();
        names[names.length - 1]?.scrollIntoView({ block: 'center' });
      });
    },
    onUndoRoll: undoAdjustment,
  };
  const summaryProps = { dealInput, result, hasInputErrors, onActivatePaymentTarget: activatePaymentTarget,
    onRepairEstimate: repairEstimate, lastRoll, onUndoRoll: undoAdjustment,
    onComparePayments: scrollToGrid, onReviewEstimate: () => changeView('customer'),
    onStartEstimate: () => { dispatch({ type: 'grid-visibility', open: false }); setAccordions(current => ({ ...current, vehicle: true })); focusDestination('sale-price'); } };

  return (
    <ValidationContext.Provider value={reportError}><DraftContext.Provider value={draftContext}>
      <div className={`app-frame ${view === 'dealer' && mobileGridOpen && result.isFinanced ? 'has-mobile-grid-open' : ''}`}>
        <a className="skip-link" href={view === 'customer' ? '#customer-heading' : '#calculator-top'}>Skip to calculator</a>
        <ViewToggle brand={brand} onOpenSettings={() => setSettingsOpen(true)} onReset={resetDeal} onViewChange={changeView} settingsButtonRef={settingsButtonRef} view={view} />
        {view === 'dealer' ? <PolicyReminder shortText={policyReviewReminderShort(today)} text={policyReviewReminder(today)} /> : null}
        {view === 'dealer' ? <p className="coverage-note" role="region" aria-label="Supported tax coverage"><span>Michigan resident purchases only.</span> <button type="button" onClick={() => { setContextOpen(true); focusDestination('registration-state'); }}>Review tax coverage</button></p> : null}
        {settingsChanged ? <div className="validation-banner" role="alert" id="settings-changed" tabIndex={-1}><strong>Dealership settings changed in another tab.</strong> Reload to use the saved name, logo and fees before comparing or sharing an estimate. <button type="button" onClick={() => window.location.reload()}>Reload settings</button></div> : null}
        {draftStatus === 'rejected' ? <div className="validation-banner" role="alert"><strong>The saved worksheet could not be restored.</strong> Its saved data has been kept. This worksheet will not overwrite it. Use a compatible app version or explicitly discard it to save this worksheet. <button type="button" onClick={discardRejectedDraft}>Discard unreadable draft</button></div> : null}
        {draftStatus === 'conflict' || draftStatus === 'error' ? <div className="validation-banner" role="alert"><strong>This worksheet has not been saved.</strong> {draftStatus === 'conflict' ? 'Another tab changed the saved draft. Keep your current figures before reloading.' : 'Device storage is unavailable. Keep this page open and save or print your estimate before leaving.'}</div> : null}
        {settingsOpen ? <DealershipSettingsDialog externalChange={settingsChanged} feeSettings={feeSettings} settings={brandSettings} onClear={clearSettings} onClose={closeSettings} onSave={saveSettings} /> : null}
        {inventoryOpen ? <InventoryPicker onClose={() => { setInventoryOpen(false); requestAnimationFrame(() => document.getElementById('inventory-picker-trigger')?.focus()); }} onChoose={vehicle => { setInventoryOpen(false); setVehicleImport({ vehicle, error: null }); }} /> : null}
        {vehicleImport.vehicle || vehicleImport.error ? <VehicleImportDialog {...vehicleImport} hasDraftEdits={hasDraftEdits} onAccept={acceptVehicle} onClose={closeVehicleImport} /> : null}
        {Object.keys(fieldErrors).length > 0 || calculation.error ? <div className="validation-banner" role="alert">
          <strong>{purchaseScope.supported ? 'Check the highlighted figures.' : 'Tax rules unavailable.'}</strong> {calculation.error || 'The estimate uses the last valid values. Correct the input before comparing or creating a proposal.'}
          {Object.keys(fieldErrors).length || calculation.errorField ? <button type="button" onClick={focusFirstError}>Go to field</button> : null}
        </div> : null}
        <main className="calculator-shell" id="calculator-top" aria-label={view === 'dealer' ? 'Deal workspace' : 'Customer estimate workspace'} tabIndex={-1} key={`desk-${resetCount}`}>
          {view === 'dealer' ? <>
            <div className="calculator-layout">
              <div className="calculator-left">
                <div className="page-intro worksheet-intro" role="region" aria-label="Worksheet introduction"><div><h1 id="worksheet-heading" tabIndex={-1}>Build the deal. See the payment.</h1><p>Adjust the figures, compare your options, and see the complete deal.</p></div><p className={`worksheet-save ${draftSaved ? 'is-saved' : 'needs-attention'}`}><span aria-hidden="true">{draftSaved ? '✓' : '!'}</span>{draftSaved ? 'Saved on this device' : draftStatus === 'saving' ? 'Saving on this device…' : 'Draft not saved — see below'}</p></div>
                <div className="mobile-results" id="payment-results-mobile" tabIndex={-1}><ResultsPanel {...summaryProps} compact /></div>
                <QuickJumpNav />
                <div className="deal-tools">
                <details className="deal-details" open={contextOpen} onToggle={event => setContextOpen(event.currentTarget.open)}>
                <summary><strong>Deal details</strong><span>{dealInput.vehicleDescription || 'Vehicle reference & estimate date'}</span><time dateTime={dealInput.dealDate}>{formatShortDate(dealInput.dealDate)}</time></summary>
                <div className="deal-context">
                  <label className="vehicle-reference-field" htmlFor="vehicle-reference">Vehicle / stock reference <span>Optional</span><input id="vehicle-reference" className="text-input" type="text" maxLength={100} value={dealInput.vehicleDescription} onChange={e => updateField('vehicleDescription', e.target.value)} placeholder="e.g. 2024 Explorer · H12345" /></label>
                  <EstimateDateField value={dealInput.dealDate} onChange={value => updateField('dealDate', value)} />
                  <label htmlFor="registration-state">Registration state<select aria-label="Buyer registration state" className="text-input" id="registration-state" value={dealInput.registrationState} aria-invalid={purchaseScope.errorField === 'registration-state' || undefined} aria-describedby="purchase-coverage" onChange={event => updateField('registrationState', event.target.value)}><option value="">Choose state</option>{REGISTRATION_STATES.map(state => <option key={state.value} value={state.value}>{state.label}</option>)}</select></label>
                  <label className="transaction-scope-field" htmlFor="transaction-scope">Transaction coverage<select aria-label="Transaction coverage" className="text-input" id="transaction-scope" value={dealInput.transactionScope} aria-invalid={purchaseScope.errorField === 'transaction-scope' || undefined} aria-describedby="purchase-coverage" onChange={event => updateField('transactionScope', event.target.value)}><option value="">Choose transaction</option>{TRANSACTION_SCOPES.map(scope => <option key={scope.value} value={scope.value}>{scope.label}</option>)}</select></label>
                  <p id="purchase-coverage" className="coverage-description">Supports taxable Michigan resident cash and finance purchases. Other states and transaction types need verified automatic rules.</p>
                </div>
                </details>
                <button className="inventory-picker-trigger" id="inventory-picker-trigger" onClick={() => setInventoryOpen(true)} type="button">Inventory</button>
                </div>
                <DealerView accordions={accordions} addItem={preset => dispatch({ type: 'add-item', preset })} dealInput={dealInput}
                  removeItem={index => {
                    const item = deal.optionalItems[index];
                    if (!item) return;
                    setInputDrafts(current => { const next = { ...current }; delete next[`product-${item.id}-amount`]; return next; });
                    dispatch({ type: 'remove-item', index });
                  }} result={result} targetProps={targetProps} purchaseScope={purchaseScope}
                  toggleAccordion={name => setAccordions(current => ({ ...current, [name]: !current[name] }))}
                  updateField={updateField} updateItem={(index, patch) => dispatch({ type: 'item', index, patch })} />
              </div>
              <div className="desktop-results" id="payment-results" tabIndex={-1}><ResultsPanel {...summaryProps} /></div>
            </div>
            {result.isFinanced ? <button className="grid-jump" onClick={scrollToGrid} type="button"><span>Payment grid</span><strong>Compare terms, rates, and down payments</strong></button> : null}
          </> : <>
            <div className="page-intro page-intro--customer"><h1 id="customer-heading" tabIndex={-1}>Your purchase estimate</h1><p>The selected vehicle, products, and payment — together in one place.</p></div>
            <CustomerView brand={brand} dealInput={dealInput} gridRates={gridRates} result={result} hasInputErrors={hasInputErrors} onEditDeal={() => changeView('dealer')} onRepairEstimate={repairEstimate} onAdjustPayments={adjustCustomerOptions} />
          </>}
        </main>
        {view === 'dealer' && result.isFinanced ? <PaymentGrid key={`grid-${resetCount}`} dealInput={dealInput} downPayments={gridDownPayments}
          onApplyScenario={patch => {
            if (hasInputErrors) { focusFirstError(); return; }
            const candidate = { ...dealInput, ...patch };
            try {
              if (!getProposalStatus({ dealInput: candidate, result: calculateDeal(candidate) }).canExport) return;
            } catch { return; }
            dispatch({ type: 'grid', patch, label: `Payment option applied: ${patch.termMonths} months at ${formatNumber(patch.apr)}% with ${formatCurrency(patch.cashDown)} down` });
            if (isMobile()) focusDestination('payment-results-mobile');
          }}
          onMobileClose={closeGrid} onDownPaymentChange={(index, value) => dispatch({ type: 'down', index, value })}
          onRateChange={(term, value) => dispatch({ type: 'rate', term, value })}
          rates={gridRates} result={result} mobileOpen={mobileGridOpen} hasInputErrors={hasInputErrors} canCompare={canCompare} onRepairEstimate={repairEstimate} onStartEstimate={summaryProps.onStartEstimate} /> : null}
        <footer className="app-footer">
          <p>Estimates only. Subject to lender approval and final taxes, fees, and deal structure.</p>
          <p>{draftStatus === 'conflict' ? 'Another tab changed the saved draft. This worksheet has not been saved. Copy or print it, then reload to open the latest draft.'
            : draftStatus === 'rejected' ? 'Unreadable saved worksheet preserved. Discard it explicitly before saving a replacement.'
            : draftStatus === 'saving' ? 'Saving draft on this device…'
            : draftSaved ? 'Draft saved on this device. Refreshing keeps your figures; Reset deal clears them.'
            : 'Draft could not be saved on this device. Keep this page open until you copy or print your estimate.'}</p>
          <p>Michigan purchase estimates · v{APP_VERSION} · {BUILD_ID}</p>
          <p><a href="./help.html" target="_blank" rel="noreferrer">Help and supported scope</a> · <a href="./data-practices.html" target="_blank" rel="noreferrer">Data on this device</a> · <a href="./THIRD-PARTY-NOTICES.txt" target="_blank" rel="noreferrer">Third-party notices</a></p>
        </footer>
        {view === 'dealer' && result.isFinanced ? <MobileNav onGrid={scrollToGrid} onPayment={() => { if (!(result.salePrice > 0)) { summaryProps.onStartEstimate(); return; } dispatch({ type: 'grid-visibility', open: false }); focusDestination('payment-results-mobile'); }} payment={result.monthlyPayment} hasEstimate={result.salePrice > 0} /> : null}
      </div>
    </DraftContext.Provider></ValidationContext.Provider>
  );
}
