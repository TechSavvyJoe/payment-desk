import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { calculateDeal } from './lib/calculations.js';
import { createDeskState, deskReducer, hasDealEdits } from './lib/dealState.js';
import { APP_VERSION, BUILD_ID } from './lib/release.js';
import { loadBrandSettings, resolveBrand } from './lib/brandSettings.js';
import { loadFeeSettings, resolveFees } from './lib/feeSettings.js';
import { clearDeviceSettings, saveDeviceSettings } from './lib/deviceSettings.js';
import { policyReviewReminder, policyReviewReminderShort, todayDealDate } from './lib/policy.js';
import { getProposalStatus } from './lib/proposal.js';
import { formatShortDate } from './lib/formatters.js';
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
import { createDeskDraftSession, DESK_DRAFT_KEY, hasDeskDraftEdits, isDeskDraftField } from './lib/deskDraft.js';
import { DraftContext } from './components/DraftContext.jsx';
import { HANDOFF_PREFIX, parseVehicleHandoff } from '../extensions/payment-desk-companion/vehicleHandoff.js';

const allOpen = () => ({ vehicle: true, trade: true, taxes: true, roll: true });
const isMobile = () => window.matchMedia('(max-width: 800px)').matches;
const focusDestination = id => requestAnimationFrame(() => {
  const node = document.getElementById(id);
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
  const [draftStatus, setDraftStatus] = useState('saving');
  const draftSaved = draftStatus === 'saved';
  const rememberInput = useCallback((id, raw) => { if (isDeskDraftField(id)) setInputDrafts(current => current[id]?.raw === raw ? current : { ...current, [id]: { raw } }); }, []);
  const draftContext = useMemo(() => ({ values: inputDrafts, remember: rememberInput }), [inputDrafts, rememberInput]);
  const { deal, view, mobileGridOpen, gridRates, gridDownPayments, lastRoll, resetCount } = state;
  const [brandSettings, setBrandSettings] = useState(loadBrandSettings);
  const brand = useMemo(() => resolveBrand(brandSettings), [brandSettings]);
  // The dealership's fees live beside the deal, never in it, so Reset deal and
  // hasDealEdits ignore them. Every calculation reads them from this one dealInput.
  const [feeSettings, setFeeSettings] = useState(loadFeeSettings);
  const dealershipFees = useMemo(() => resolveFees(feeSettings), [feeSettings]);
  const dealInput = useMemo(() => ({ ...deal, dealershipFees }), [deal, dealershipFees]);
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
    return { ok: outcome.ok };
  };
  const saveSettings = (nextBrand, nextFees) => applySettings(saveDeviceSettings(nextBrand, nextFees));
  const clearSettings = () => applySettings(clearDeviceSettings());
  const closeSettings = () => { setSettingsOpen(false); requestAnimationFrame(() => settingsButtonRef.current?.focus()); };
  const [targetType, setTargetType] = useState(() => restoredDraft?.targetType ?? 'payment');
  const [targetValues, setTargetValues] = useState(() => restoredDraft?.targetValues ?? { payment: '', outTheDoor: '', amountFinanced: '', cashDue: '' });
  const [solverExpanded, setSolverExpanded] = useState(false);
  const [accordions, setAccordions] = useState(allOpen);
  const [contextOpen, setContextOpen] = useState(false);
  useEffect(() => {
    const changed = event => {
      if (event.key !== null && event.key !== DESK_DRAFT_KEY) return;
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
    setDraftStatus(status => status === 'conflict' ? status : 'saving');
    void draftSession.save({ desk: state, targetType, targetValues, inputDrafts }).then(outcome => {
      if (!current) return;
      const status = draftSession.status();
      setDraftStatus(outcome.conflict || status === 'conflict' ? 'conflict' : outcome.ok && status === 'saved' ? 'saved' : 'error');
    });
    return () => { current = false; };
  }, [draftSession, state, targetType, targetValues, inputDrafts]);
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
    catch { return { result: calculateDeal({ ...createDeskState().deal, dealershipFees }), error: 'These figures exceed the supported calculation range. Reduce the amounts before continuing.' }; }
  }, [dealInput, dealershipFees]);
  const result = calculation.result;
  const hasInputErrors = Object.keys(fieldErrors).length > 0 || Boolean(calculation.error);
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
    const errorId = Object.keys(fieldErrors)[0];
    const field = document.getElementById(errorId);
    if (field?.closest('.deal-details')) setContextOpen(true);
    if (isMobile()) dispatch({ type: 'grid-visibility', open: Boolean(field?.closest('#payment-grid')) });
    requestAnimationFrame(() => {
      const destination = document.getElementById(errorId);
      destination?.focus();
      destination?.scrollIntoView({ block: 'center' });
    });
  };
  const updateField = (field, value) => {
    if (field === 'dealType') setTargetType(value === 'cash' ? 'cashDue' : 'payment');
    dispatch({ type: 'field', field, value });
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
  const clearDeal = () => {
    setDraftStatus(status => status === 'conflict' ? status : 'saving');
    dispatch({ type: 'reset' });
    setInputDrafts({});
    setTargetType('payment'); setTargetValues({ payment: '', outTheDoor: '', amountFinanced: '', cashDue: '' });
    setSolverExpanded(false); setAccordions(allOpen()); setFieldErrors({}); setContextOpen(false);
  };
  const resetDeal = () => {
    if (hasDeal && !window.confirm('Reset this deal? All figures, trade, and products will be cleared.')) return;
    clearDeal();
    focusDestination('worksheet-heading');
  };
  const closeVehicleImport = () => { setVehicleImport({ vehicle: null, error: null }); focusDestination('sale-price'); };
  const acceptVehicle = vehicle => {
    clearDeal();
    dispatch({ type: 'apply', patch: { salePrice: vehicle.salePrice, vehicleDescription: vehicle.vehicleDescription } });
    setContextOpen(Boolean(vehicle.vehicleDescription));
    closeVehicleImport();
  };
  const activatePaymentTarget = value => {
    setTargetType('payment');
    setTargetValues(current => ({ ...current, payment: value }));
    requestAnimationFrame(() => {
      targetInputRef.current?.focus();
      targetInputRef.current?.select();
      targetInputRef.current?.scrollIntoView({ block: 'center' });
    });
  };
  const targetProps = {
    targetType, targetValues, gridRates, lastRoll, targetInputRef, hasInputErrors, canCompare,
    onTargetTypeChange: setTargetType,
    onTargetValueChange: (type, value) => setTargetValues(current => ({ ...current, [type]: value })),
    expanded: solverExpanded, onExpandedChange: setSolverExpanded,
    onApplyPatch: (patch, label) => dispatch({ type: 'apply', patch, label }),
    onApplyItemPatch: ({ index, amount }, label) => dispatch({ type: 'item', index, patch: { amount }, label }),
    onAddRoomItem: (amount, label) => {
      dispatch({ type: 'add-item', preset: { category: 'other', name: '', amount, taxable: false, taxTreatmentConfirmed: false }, label });
      setAccordions(current => ({ ...current, roll: true }));
      requestAnimationFrame(() => {
        const names = document.querySelectorAll('[aria-label^="Name for product or add-on"]');
        names[names.length - 1]?.focus();
        names[names.length - 1]?.scrollIntoView({ block: 'center' });
      });
    },
    onUndoRoll: () => dispatch({ type: 'undo' }),
  };
  const summaryProps = { dealInput, result, hasInputErrors, onActivatePaymentTarget: activatePaymentTarget,
    onComparePayments: scrollToGrid, onReviewEstimate: () => changeView('customer'),
    onStartEstimate: () => { dispatch({ type: 'grid-visibility', open: false }); setAccordions(current => ({ ...current, vehicle: true })); focusDestination('sale-price'); } };

  return (
    <ValidationContext.Provider value={reportError}><DraftContext.Provider value={draftContext}>
      <div className={`app-frame ${view === 'dealer' && mobileGridOpen && result.isFinanced ? 'has-mobile-grid-open' : ''}`}>
        <a className="skip-link" href={view === 'customer' ? '#customer-heading' : '#worksheet-heading'}>Skip to calculator</a>
        <ViewToggle brand={brand} onOpenSettings={() => setSettingsOpen(true)} onReset={resetDeal} onViewChange={changeView} settingsButtonRef={settingsButtonRef} view={view} />
        {view === 'dealer' ? <PolicyReminder shortText={policyReviewReminderShort(today)} text={policyReviewReminder(today)} /> : null}
        {settingsOpen ? <DealershipSettingsDialog feeSettings={feeSettings} settings={brandSettings} onClear={clearSettings} onClose={closeSettings} onSave={saveSettings} /> : null}
        {inventoryOpen ? <InventoryPicker onClose={() => { setInventoryOpen(false); requestAnimationFrame(() => document.getElementById('inventory-picker-trigger')?.focus()); }} onChoose={vehicle => { setInventoryOpen(false); setVehicleImport({ vehicle, error: null }); }} /> : null}
        {vehicleImport.vehicle || vehicleImport.error ? <VehicleImportDialog {...vehicleImport} hasDraftEdits={hasDraftEdits} onAccept={acceptVehicle} onClose={closeVehicleImport} /> : null}
        {hasInputErrors ? <div className="validation-banner" role="alert">
          <strong>Check the highlighted figures.</strong> {calculation.error || 'The estimate uses the last valid values. Correct the input before comparing or creating a proposal.'}
          {Object.keys(fieldErrors).length ? <button type="button" onClick={focusFirstError}>Go to field</button> : null}
        </div> : null}
        <div className="calculator-shell" id="calculator-top" key={`desk-${resetCount}`}>
          {view === 'dealer' ? <>
            <div className="calculator-layout">
              <div className="calculator-left">
                <div className="page-intro" role="region" aria-label="Worksheet introduction"><h1 id="worksheet-heading" tabIndex={-1}>Build the deal. See the payment.</h1><p>Adjust the figures, compare your options, and see the complete deal.</p></div>
                <div className="mobile-results" id="payment-results-mobile" tabIndex={-1}><ResultsPanel {...summaryProps} compact /></div>
                <QuickJumpNav />
                <div className="deal-tools">
                <details className="deal-details" open={contextOpen} onToggle={event => setContextOpen(event.currentTarget.open)}>
                <summary><strong>Deal details</strong><span>{dealInput.vehicleDescription || 'Vehicle reference & estimate date'}</span><time dateTime={dealInput.dealDate}>{formatShortDate(dealInput.dealDate)}</time></summary>
                <div className="deal-context">
                  <label htmlFor="vehicle-reference">Vehicle / stock reference <span>Optional</span><input id="vehicle-reference" className="text-input" type="text" maxLength={100} value={dealInput.vehicleDescription} onChange={e => updateField('vehicleDescription', e.target.value)} placeholder="e.g. 2024 Explorer · H12345" /></label>
                  <EstimateDateField value={dealInput.dealDate} onChange={value => updateField('dealDate', value)} />
                </div>
                </details>
                <button className="inventory-picker-trigger" id="inventory-picker-trigger" onClick={() => setInventoryOpen(true)} type="button">Inventory</button>
                </div>
                <DealerView accordions={accordions} addItem={preset => dispatch({ type: 'add-item', preset })} dealInput={dealInput}
                  removeItem={index => dispatch({ type: 'remove-item', index })} result={result} targetProps={targetProps}
                  toggleAccordion={name => setAccordions(current => ({ ...current, [name]: !current[name] }))}
                  updateField={updateField} updateItem={(index, patch) => dispatch({ type: 'item', index, patch })} />
              </div>
              <div className="desktop-results" id="payment-results" tabIndex={-1}><ResultsPanel {...summaryProps} /></div>
            </div>
            {result.isFinanced ? <button className="grid-jump" onClick={scrollToGrid} type="button"><span>Payment grid</span><strong>Compare terms, rates, and down payments</strong></button> : null}
          </> : <>
            <div className="page-intro page-intro--customer"><h1 id="customer-heading" tabIndex={-1}>Your purchase estimate</h1><p>The selected vehicle, products, and payment — together in one place.</p></div>
            <CustomerView brand={brand} dealInput={dealInput} gridRates={gridRates} result={result} hasInputErrors={hasInputErrors} onEditDeal={() => changeView('dealer')} />
          </>}
        </div>
        {view === 'dealer' && result.isFinanced ? <PaymentGrid key={`grid-${resetCount}`} dealInput={dealInput} downPayments={gridDownPayments}
          onApplyScenario={patch => { if (hasInputErrors) { focusFirstError(); return; } if (!canCompare) return; dispatch({ type: 'grid', patch }); if (isMobile()) focusDestination('payment-results-mobile'); }}
          onMobileClose={closeGrid} onDownPaymentChange={(index, value) => dispatch({ type: 'down', index, value })}
          onRateChange={(term, value) => dispatch({ type: 'rate', term, value })}
          rates={gridRates} result={result} mobileOpen={mobileGridOpen} hasInputErrors={hasInputErrors} canCompare={canCompare} onStartEstimate={summaryProps.onStartEstimate} /> : null}
        <footer className="app-footer">
          <p>Estimates only. Subject to lender approval and final taxes, fees, and deal structure.</p>
          <p>{draftStatus === 'conflict' ? 'Another tab changed the saved draft. This worksheet has not been saved. Copy or print it, then reload to open the latest draft.'
            : draftStatus === 'saving' ? 'Saving draft on this device…'
            : draftSaved ? 'Draft saved on this device. Refreshing keeps your figures; Reset deal clears them.'
            : 'Draft could not be saved on this device. Keep this page open until you copy or print your estimate.'}</p>
          <p>Michigan purchase estimates · v{APP_VERSION} · {BUILD_ID}</p>
        </footer>
        {view === 'dealer' && result.isFinanced ? <MobileNav onGrid={scrollToGrid} onPayment={() => { if (!(result.salePrice > 0)) { summaryProps.onStartEstimate(); return; } dispatch({ type: 'grid-visibility', open: false }); focusDestination('payment-results-mobile'); }} payment={result.monthlyPayment} hasEstimate={result.salePrice > 0} /> : null}
      </div>
    </DraftContext.Provider></ValidationContext.Provider>
  );
}
