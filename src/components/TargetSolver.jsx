import { useMemo, useState } from 'react';
import { buildBudgetSuggestions, buildSuggestions } from '../lib/suggestions.js';
import { getProposalStatus } from '../lib/proposal.js';
import { getPurchaseScope } from '../lib/purchaseScope.js';
import { FINANCE_MODEL_EXPLANATION } from '../lib/financeModel.js';
import { parseFinancialInput } from '../lib/inputValidation.js';
import { fromCents } from '../lib/calculations.js';
import { useInputDrafts } from './DraftContext.jsx';
import { formatCurrency } from '../lib/formatters.js';
import { MoneyInput, SegmentedControl } from './Fields.jsx';
import { ArrowIcon, ResetIcon, TargetIcon } from './Icons.jsx';

const signedInterest = cents => `${cents < 0 ? '−' : '+'}${formatCurrency(fromCents(Math.abs(cents)), { cents: true })}`;

const labels = { payment: 'payment', outTheDoor: 'out-the-door total', amountFinanced: 'loan balance', cashDue: 'cash due after trade' };
const explanations = {
  payment: 'Monthly payment at the entered interest rate and term. Cash down, trade, taxes, fees, and products are included.',
  outTheDoor: 'Vehicle, taxes, fees, and products before subtracting cash down or trade equity.',
  amountFinanced: 'Loan balance after cash down and the selected trade/payoff treatment.',
  cashDue: 'Final cash purchase total including taxes, fees, products, and trade/payoff. Cash down is not subtracted again.',
};

export default function TargetSolver({ dealInput, result, targetType, targetValues, onTargetTypeChange,
  onTargetValueChange, gridRates, expanded, onExpandedChange, onApplyPatch, onApplyItemPatch,
  onAddRoomItem, lastRoll, onUndoRoll, targetInputRef, targetInputRevision = 0, hasInputErrors = false, canCompare = true, cashLimit = '', onCashLimitChange = () => {}, onClearCashLimit }) {
  const inputDrafts = useInputDrafts();
  const [budgetMode, setBudgetMode] = useState(() => String(cashLimit).trim() !== '' || Boolean(inputDrafts?.values['budget-cash-limit']?.raw));
  const budgetActive = targetType === 'payment' && budgetMode && (String(cashLimit).trim() !== '' || Boolean(inputDrafts?.values['budget-cash-limit']?.raw));
  const budgetDraftInvalid = Boolean(parseFinancialInput(inputDrafts?.values['budget-cash-limit']?.raw).error);
  const targetValue = targetValues[targetType];
  const solution = useMemo(() => budgetActive
    ? buildBudgetSuggestions({ dealInput, targetValue, cashLimit, gridRates, hasInputErrors: hasInputErrors || budgetDraftInvalid })
    : getPurchaseScope(dealInput).supported
    ? buildSuggestions({ dealInput, result, targetType, targetValue, gridRates })
    : { suggestions: [], empty: true, error: getPurchaseScope(dealInput).reason },
  [dealInput, result, targetType, targetValue, gridRates, budgetActive, cashLimit, hasInputErrors, budgetDraftInvalid]);
  const suggestions = budgetActive || expanded ? solution.suggestions : solution.suggestions.slice(0, 3);
  const canApply = suggestion => !suggestion.informational && !hasInputErrors && !(budgetActive && budgetDraftInvalid) && getProposalStatus({
    dealInput: { ...dealInput, ...suggestion.patch }, result: suggestion.previewDeal,
  }).canExport;
  const summary = hasInputErrors ? 'Correct the highlighted figures to compare adjustments.'
    : !(result.salePrice > 0) ? 'Selling price unknown? Enter the customer’s target below to calculate the price needed. Set trade, products, fees, and loan terms first.'
    : !canCompare ? 'Complete the estimate and product tax choices before applying adjustments.'
    : solution.error || (solution.empty ? 'Enter a target to see the changes available.'
      : solution.alreadyMet ? `Your current ${labels[targetType]} already matches this target.`
        : solution.direction === 'increase' ? 'The current estimate is below this target. These are optional ways to use the remaining room.'
          : 'Compare each result before applying a change. Rates and trade adjustments require approval.');

  const toggleBudget = () => {
    if (budgetMode) {
      if (onClearCashLimit) onClearCashLimit();
      else { onCashLimitChange(''); inputDrafts?.remember('budget-cash-limit', ''); }
    }
    setBudgetMode(!budgetMode);
  };

  const apply = suggestion => {
    if (!canApply(suggestion)) return;
    if (suggestion.patch) onApplyPatch(suggestion.patch, suggestion.title);
    if (suggestion.itemPatch) onApplyItemPatch(suggestion.itemPatch, suggestion.title);
    if (suggestion.addRoomItem) onAddRoomItem(suggestion.addRoomItem, suggestion.title);
  };
  return <section className="target-panel" id="target-solver" aria-labelledby="target-heading">
    <div className="target-panel__heading"><div><h2 id="target-heading" tabIndex={-1}><TargetIcon size={22} />Roll to a target</h2><p>Start with the customer’s number. Work back to the deal.</p></div>
      {!budgetActive && solution.suggestions.length > 3 ? <button className="text-action" aria-controls="suggestion-list" aria-expanded={expanded} onClick={() => onExpandedChange(!expanded)} type="button">{expanded ? 'Show fewer' : 'See all options'}<ArrowIcon direction={expanded ? 'up' : 'right'} size={18} /></button> : null}
    </div>
    {lastRoll ? <div className="target-undo" role="status"><span>Applied <strong>{lastRoll.label}</strong>. Undo is available until your next edit.</span><button className="undo-button" type="button" onClick={onUndoRoll}><ResetIcon size={17} />Undo adjustment</button></div> : null}
    <div className={`target-panel__body ${solution.empty ? 'is-empty' : ''}`}>
      <div className={`target-setup${targetType === 'payment' && budgetMode ? ' is-budget-mode' : ''}`}>
        <SegmentedControl className="target-tabs" label="Target type" onChange={onTargetTypeChange} options={result.isFinanced ? [{ label: 'Payment', value: 'payment' }, { label: 'Out-the-door', value: 'outTheDoor' }, { label: 'Loan balance', value: 'amountFinanced' }] : [{ label: 'Cash due after trade', value: 'cashDue' }, { label: 'Out-the-door', value: 'outTheDoor' }]} value={targetType} />
        <div className="target-input-row"><label htmlFor="target-value">Target {labels[targetType]}</label><MoneyInput key={`${targetType}-${targetInputRevision}`} ariaLabel={`Target ${labels[targetType]}`} id="target-value" onChange={value => onTargetValueChange(targetType, value)} ref={targetInputRef} value={targetValue} /><span>{targetType === 'payment' ? 'per month' : ''}</span></div>
        {targetType === 'payment' ? <div className="budget-setup">
          <button className="text-action budget-toggle" type="button" aria-expanded={budgetMode} aria-controls="budget-limit-setup" onClick={toggleBudget}>Payment + cash limits</button>
          {budgetMode ? <div id="budget-limit-setup" className="budget-limit-setup">
            <div className="target-input-row"><label htmlFor="budget-cash-limit">Max cash at signing <small>(optional)</small></label><MoneyInput id="budget-cash-limit" ariaLabel="Maximum total due at signing" value={cashLimit} onChange={onCashLimitChange} aria-describedby="budget-limit-help" /></div>
            <p className="target-definition" id="budget-limit-help">Includes all cash due at signing. Leave blank for one-part adjustments; enter a limit to compare terms and cash down with price, trade, products and fees fixed.</p>
          </div> : null}
        </div> : null}
        <p className="target-summary" aria-live="polite">{budgetActive ? solution.error || (solution.empty ? 'Enter a payment target to compare both limits.' : solution.status === 'no-match' ? 'No option meets both limits at the entered term and rate assumptions.' : 'Options meet both limits at the entered assumptions. Confirm lender approval separately.') : summary}</p>
        {!budgetActive ? <p className="target-definition">{explanations[targetType]} Each scenario changes one part of the deal; Apply recalculates the remaining options.</p> : null}
        {targetValue !== '' && result.salePrice > 0 ? <p className="target-current">Current {labels[targetType]}: <strong>{formatCurrency(targetType === 'payment' ? result.monthlyPayment : targetType === 'cashDue' ? result.dueAtSigning : result[targetType])}</strong></p> : null}
      </div>
      <div className={`suggestion-list ${budgetActive ? 'budget-options' : ''}`} id="suggestion-list">
        {!suggestions.length ? <p className="suggestion-empty">{budgetActive ? solution.error || (solution.empty ? 'Enter both limits to see options.' : 'No option meets both limits at the entered term and rate assumptions.') : solution.alreadyMet ? 'No adjustment is needed.' : solution.empty ? 'Your comparison options will appear here.' : 'No supported adjustment is available for this target.'}</p> : null}
        {budgetActive ? suggestions.map(option => <article className="suggestion budget-option" key={option.id}>
          <div className="suggestion__heading"><h3>{option.title}</h3>{option.informational ? null : <button className="apply-button" type="button" aria-label={`Apply ${option.title}`} disabled={!canApply(option)} onClick={() => apply(option)}>Apply</button>}</div>
          <dl className="suggestion-metrics budget-option__metrics">
            <div><dt>Term / assumed annual interest rate</dt><dd>{option.previewDeal.termMonths} months / {option.previewDeal.apr.toFixed(2)}%</dd></div>
            <div><dt>Cash down</dt><dd>{formatCurrency(option.previewDeal.cashDown, { cents: true })}</dd></div>
            <div><dt>Total due at signing</dt><dd>{formatCurrency(option.previewDeal.dueAtSigning, { cents: true })}</dd></div>
            <div><dt>Monthly payment</dt><dd>{formatCurrency(option.previewDeal.monthlyPayment, { cents: true })}/mo</dd></div>
            <div><dt>Estimated total interest</dt><dd>{formatCurrency(option.previewDeal.totalInterest, { cents: true })}</dd></div>
            <div><dt>Interest change vs current</dt><dd>{signedInterest(option.interestDeltaCents)}</dd></div>
          </dl>
        </article>) : suggestions.map(suggestion => <article className="suggestion" key={suggestion.id}>
          <div className="suggestion__heading"><ArrowIcon direction={suggestion.iconDirection} size={21} /><div className="suggestion__identity"><h3>{suggestion.title}</h3><strong className="suggestion__value">{suggestion.value}</strong></div><button aria-label={`${suggestion.requiresProductSelection ? 'Choose product for' : 'Apply'} ${suggestion.title}`} className="apply-button" disabled={!canApply(suggestion)} onClick={() => apply(suggestion)} type="button">{suggestion.requiresProductSelection ? 'Choose product' : 'Apply'}</button></div>
          <div className="suggestion__copy">
            {suggestion.previewDeal ? <div className="suggestion-price"><span>Resulting selling price</span><strong>{formatCurrency(suggestion.previewDeal.salePrice, { cents: true })}</strong></div> : null}
            <div className="suggestion-preview">
              {suggestion.previewDeal ? <strong>{suggestion.previewDeal.isFinanced ? `${formatCurrency(suggestion.previewDeal.monthlyPayment, { cents: true })}/mo` : `${suggestion.previewDeal.customerCredit > 0 ? 'Credit' : 'Cash due'} ${formatCurrency(suggestion.previewDeal.customerCredit || suggestion.previewDeal.dueAtSigning, { cents: true })}`}</strong> : null}
              <span className={`suggestion-status ${suggestion.requiresProductSelection ? 'needs-action' : suggestion.withinTarget ? 'is-met' : ''}`}>{suggestion.requiresProductSelection ? 'Product setup needed' : suggestion.exact ? 'Meets target' : suggestion.withinTarget ? 'Within target' : `${formatCurrency(suggestion.remainingGap)} remaining to target`}</span>
            </div>
            {suggestion.previewDeal ? <dl className={`suggestion-metrics ${suggestion.previewDeal.isFinanced ? 'is-financed' : ''}`}><div><dt>Due at signing</dt><dd>{formatCurrency(suggestion.previewDeal.dueAtSigning)}</dd></div>{suggestion.previewDeal.isFinanced ? <div><dt>Estimated loan balance</dt><dd>{formatCurrency(suggestion.previewDeal.amountFinanced)}</dd></div> : null}<div><dt>Out-the-door</dt><dd>{formatCurrency(suggestion.previewDeal.outTheDoor)}</dd></div></dl> : null}
            {suggestion.id === 'term' ? <dl className="suggestion-metrics suggestion-interest"><div><dt>Estimated total interest</dt><dd>{formatCurrency(suggestion.previewDeal.totalInterest, { cents: true })}</dd></div><div><dt>Interest change vs current</dt><dd>{signedInterest(suggestion.interestDeltaCents)} vs {result.termMonths} months / {result.apr.toFixed(2)}%</dd></div></dl> : null}
            {suggestion.id === 'term' ? <p className="suggestion-note">{FINANCE_MODEL_EXPLANATION}</p> : null}
            {suggestion.note ? <p className="suggestion-note">{suggestion.note}</p> : null}
          </div>
        </article>)}
        {budgetActive && suggestions.length ? <p className="suggestion-note budget-qualification">{FINANCE_MODEL_EXPLANATION}</p> : null}
      </div>
    </div>
  </section>;
}
