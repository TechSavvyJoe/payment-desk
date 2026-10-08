import { useId, useState } from "react";
import { formatCurrency, formatNumber } from "../lib/formatters.js";
import { buildProposalGroups, getDealSummary } from "../lib/proposal.js";
import { ArrowIcon, ChevronIcon, EditIcon, GridIcon } from "./Icons.jsx";

const money = (value) => formatCurrency(value, { cents: true });
const BreakdownRow = ({ label, value, strong = false }) => (
  <div className={"breakdown-row" + (strong ? " is-strong" : "")}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export default function ResultsPanel({ dealInput, result, customer = false, compact = false, onActivatePaymentTarget, onComparePayments, onReviewEstimate, onStartEstimate, hasInputErrors = false }) {
  const summary = getDealSummary({ dealInput, result, hasInputErrors });
  const groups = customer ? [] : buildProposalGroups(result);
  const isStarting = !customer && !(result.salePrice > 0) && !hasInputErrors;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  // Phones start at the Selling price field; the bottom bar offers the same start action.
  if (compact && isStarting) return null;

  const totals = !isStarting ? (
    <section className="result-totals" aria-label="Key deal totals">
      {summary.isFinanced ? <BreakdownRow label="Estimated loan balance" value={money(summary.amountFinanced)} /> : null}
      <BreakdownRow label="Out-the-door total" value={money(summary.outTheDoor)} />
      <BreakdownRow label={summary.isFinanced ? "Due at signing" : "Cash due after trade"} value={money(summary.dueAtSigning)} />
      {summary.hasCashCredit ? <BreakdownRow label="Customer credit" value={money(summary.customerCredit)} /> : null}
    </section>
  ) : null;
  const warning = !isStarting && summary.reasons.length ? (
    <div className="result-warning" role="alert">
      <strong>Estimate needs attention</strong>
      {summary.reasons.map((reason) => <p key={reason}>{reason}</p>)}
    </div>
  ) : null;
  const breakdown = !customer && !isStarting ? (
    <details className="deal-breakdown">
      <summary>View itemized deal breakdown</summary>
      {groups.map((section) => (
        <section className="breakdown-group" key={section.id}>
          <h3>{section.title}</h3>
          {section.rows.map((item) => <BreakdownRow key={item.id} label={item.label} value={money(item.amount)} />)}
          <BreakdownRow label={section.total.label} value={money(section.total.amount)} strong />
        </section>
      ))}
    </details>
  ) : null;
  const review = onReviewEstimate ? <button className="estimate-review" type="button" onClick={onReviewEstimate}>Review customer estimate<ArrowIcon size={18} /></button> : null;

  return (
    <aside className={"results-panel" + (customer ? " results-panel--customer" : "") + (isStarting ? " results-panel--starting" : "")} aria-label={customer ? "Selected estimate summary" : "Current estimate summary"}>
      <section className="results-payment">
        <div className="results-payment__label-row"><h2>{summary.headline}</h2></div>
        <div className={"payment-number" + (summary.isFinanced ? "" : " payment-number--cash")}>
          <strong>{isStarting ? "—" : money(summary.headlineAmount)}</strong>
          {summary.isFinanced && !isStarting ? <span className="payment-number__suffix">/mo</span> : null}
        </div>
        {isStarting ? <p>Start with the vehicle selling price.</p> : summary.isFinanced ? (
          <p>{summary.termMonths} months at {formatNumber(summary.apr)}% interest rate</p>
        ) : <p>{summary.hasCashCredit ? "Amount in the customer's favor after trade settlement" : "Includes trade payoff or equity"}</p>}
        {!customer && !isStarting && summary.isFinanced && onActivatePaymentTarget ? (
          <button className="payment-edit-button" onClick={() => onActivatePaymentTarget(result.monthlyPayment)} type="button">
            <EditIcon size={18} />Set payment target
          </button>
        ) : null}
      </section>
      {compact ? (
        <>
          {warning}
          <div className="estimate-actions estimate-actions--compact">
            <button aria-controls={detailsId} aria-expanded={detailsOpen} className="estimate-details-toggle" onClick={() => setDetailsOpen((open) => !open)} type="button">
              Details<ChevronIcon direction={detailsOpen ? "up" : "down"} size={18} />
            </button>
            {review}
          </div>
          <div className="estimate-details" hidden={!detailsOpen} id={detailsId}>{totals}{breakdown}</div>
        </>
      ) : (
        <>
          {isStarting ? <div className="estimate-start"><strong>Your next deal starts here.</strong><p>Payments, taxes, and totals update as you enter the figures.</p><button type="button" onClick={onStartEstimate}>Enter selling price<ArrowIcon size={17} /></button></div> : totals}
          {warning}
          {breakdown}
          {!customer && !isStarting ? <div className="estimate-actions">
            {summary.isFinanced && onComparePayments ? <button className="estimate-compare" type="button" onClick={onComparePayments}><GridIcon size={18} />Compare payments</button> : null}
            {review}
            <p>Review the itemized estimate before sharing or printing.</p>
          </div> : null}
        </>
      )}
    </aside>
  );
}
