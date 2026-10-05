import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { calculateDeal } from './lib/calculations.js';
import { createDeskState, deskReducer, hasDealEdits } from './lib/dealState.js';
import { APP_VERSION, BUILD_ID } from './lib/release.js';
import { loadBrandSettings, resolveBrand } from './lib/brandSettings.js';
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

const allOpen = () => ({ vehicle: true, trade: true, taxes: true, roll: true });
const isMobile = () => window.matchMedia('(max-width: 800px)').matches;
const focusDestination = id => requestAnimationFrame(() => {
  const node = document.getElementById(id);
  if (!node) return;
  node.focus({ preventScroll: true });
  node.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
});

export default function App() {
  const [state, dispatch] = useReducer(deskReducer, undefined, createDeskState);
  const { deal: dealInput, view, mobileGridOpen, gridRates, gridDownPayments, lastRoll, resetCount } = state;
  const [brandSettings] = useState(loadBrandSettings);
  const brand = useMemo(() => resolveBrand(brandSettings), [brandSettings]);
  const [targetType, setTargetType] = useState('payment');
  const [targetValues, setTargetValues] = useState({ payment: '', outTheDoor: '', amountFinanced: '', cashDue: '' });
  const [solverExpanded, setSolverExpanded] = useState(false);
  const [accordions, setAccordions] = useState(allOpen);
  const [contextOpen, setContextOpen] = useState(false);
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
    catch { return { result: calculateDeal(createDeskState().deal), error: 'These figures exceed the supported calculation range. Reduce the amounts before continuing.' }; }
  }, [dealInput]);
  const result = calculation.result;
  const hasInputErrors = Object.keys(fieldErrors).length > 0 || Boolean(calculation.error);
  const hasDeal = hasDealEdits(state) || hasInputErrors;
  const canCompare = getProposalStatus({ dealInput, result, hasInputErrors }).canExport;

  useEffect(() => {
    if (!hasDeal) return;
    const warnBeforeLeaving = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasDeal]);

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
  const resetDeal = () => {
    if (hasDeal && !window.confirm('Reset this deal? All figures, trade, and products will be cleared.')) return;
    dispatch({ type: 'reset' });
    setTargetType('payment'); setTargetValues({ payment: '', outTheDoor: '', amountFinanced: '', cashDue: '' });
    setSolverExpanded(false); setAccordions(allOpen()); setFieldErrors({}); setContextOpen(false);
    focusDestination('worksheet-heading');
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
    <ValidationContext.Provider value={reportError}>
      <div className={`app-frame ${view === 'dealer' && mobileGridOpen && result.isFinanced ? 'has-mobile-grid-open' : ''}`}>
        <a className="skip-link" href={view === 'customer' ? '#customer-heading' : '#worksheet-heading'}>Skip to calculator</a>
        <ViewToggle brand={brand} onReset={resetDeal} onViewChange={changeView} view={view} />
        {hasInputErrors ? <div className="validation-banner" role="alert">
          <strong>Check the highlighted figures.</strong> {calculation.error || 'The estimate uses the last valid values. Correct the input before comparing or creating a proposal.'}
          {Object.keys(fieldErrors).length ? <button type="button" onClick={focusFirstError}>Go to field</button> : null}
        </div> : null}
        <div className="calculator-shell" id="calculator-top" key={`desk-${resetCount}`}>
          {view === 'dealer' ? <>
            <div className="calculator-layout">
              <div className="calculator-left">
                <div className="page-intro"><h1 id="worksheet-heading" tabIndex={-1}>Build the deal. See the payment.</h1><p>Adjust the figures, compare your options, and see the complete deal.</p></div>
                <div className="mobile-results" id="payment-results-mobile" tabIndex={-1}><ResultsPanel {...summaryProps} /></div>
                <QuickJumpNav />
                <details className="deal-details" open={contextOpen} onToggle={event => setContextOpen(event.currentTarget.open)}>
                <summary><strong>Deal details</strong><span>{dealInput.vehicleDescription || 'Vehicle reference & estimate date'}</span><time dateTime={dealInput.dealDate}>{formatShortDate(dealInput.dealDate)}</time></summary>
                <div className="deal-context">
                  <label htmlFor="vehicle-reference">Vehicle / stock reference <span>Optional</span><input id="vehicle-reference" className="text-input" type="text" maxLength={100} value={dealInput.vehicleDescription} onChange={e => updateField('vehicleDescription', e.target.value)} placeholder="e.g. 2024 Explorer · H12345" /></label>
                  <EstimateDateField value={dealInput.dealDate} onChange={value => updateField('dealDate', value)} />
                </div>
                </details>
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
          <p>Figures stay in this browser unless you share or print. Refreshing clears the deal.</p>
          <p>Michigan purchase estimates · v{APP_VERSION} · {BUILD_ID}</p>
        </footer>
        {view === 'dealer' && result.isFinanced ? <MobileNav onGrid={scrollToGrid} onPayment={() => { dispatch({ type: 'grid-visibility', open: false }); focusDestination('payment-results-mobile'); }} payment={result.monthlyPayment} hasEstimate={result.salePrice > 0} /> : null}
      </div>
    </ValidationContext.Provider>
  );
}
