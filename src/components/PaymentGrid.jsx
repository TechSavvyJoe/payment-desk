import { useEffect, useMemo, useState } from "react";
import { calculateDeal, calculateRateGrid, RATE_GRID_DEFAULTS } from "../lib/calculations.js";
import { getProposalStatus } from "../lib/proposal.js";
import { getPurchaseScope } from "../lib/purchaseScope.js";
import { formatCurrency, formatNumber } from "../lib/formatters.js";
import { MoneyInput, PercentInput } from "./Fields.jsx";
import { ArrowIcon, GridIcon } from "./Icons.jsx";

const TERMS = RATE_GRID_DEFAULTS.termMonths;

export default function PaymentGrid({
  dealInput,
  result,
  rates,
  downPayments,
  onRateChange,
  onDownPaymentChange,
  onApplyScenario,
  onMobileClose,
  mobileOpen = false,
  hasInputErrors = false,
  onRepairEstimate,
  onStartEstimate,
}) {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 800px)").matches);
  const [draftCache, setDraftCache] = useState({});
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const handleChange = (event) => setIsMobile(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);
  const grid = useMemo(() => {
    if (!getPurchaseScope(dealInput).supported) return { columns: [], rows: [] };
    const comparison = calculateRateGrid(dealInput, {
      rows: TERMS.map((termMonths) => ({ termMonths, apr: Number(rates[termMonths] ?? dealInput.apr) })),
      downPayments,
      includeCustom: false,
    });
    return {
      ...comparison,
      rows: comparison.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          const candidate = { ...dealInput, termMonths: cell.termMonths, apr: cell.apr, cashDown: cell.cashDown };
          const candidateResult = calculateDeal(candidate);
          return { ...cell, status: getProposalStatus({ dealInput: candidate, result: candidateResult, hasInputErrors }) };
        }),
      })),
    };
  }, [dealInput, rates, downPayments, hasInputErrors]);

  const isSelected = (cell) =>
    dealInput.termMonths === cell.termMonths &&
    Math.abs(dealInput.apr - cell.apr) < 0.005 &&
    Math.abs(dealInput.cashDown - cell.cashDown) < 0.005;

  const isUnavailable = (cell) => !cell.status.canExport;
  const allBlocked = !grid.rows.some((row) => row.cells.some((cell) => !isUnavailable(cell)));
  const blockedReason = grid.rows[0]?.cells[0]?.status.reasons[0] ?? result.incompleteReasons?.[0] ?? "Complete the worksheet before selecting a payment.";
  const blockedIssue = grid.rows[0]?.cells[0]?.status.issues.find(issue => issue.fieldId);
  const purchaseScope = getPurchaseScope(dealInput);
  const recoveryFieldId = !purchaseScope.supported ? purchaseScope.errorField
    : blockedIssue?.fieldId === 'cash-down' && result.amountBeforeCashDown >= 0
    && grid.rows[0].cells[0].cashDown > result.amountBeforeCashDown
    ? 'grid-down-0'
    : blockedIssue?.fieldId ?? getProposalStatus({ dealInput, result, hasInputErrors }).issues.find(issue => issue.fieldId)?.fieldId ?? 'estimate-date';
  const isStarting = !(result.salePrice > 0) && !hasInputErrors;
  const apply = (cell) => !isUnavailable(cell) && onApplyScenario({
    termMonths: cell.termMonths,
    apr: cell.apr,
    cashDown: cell.cashDown,
  });

  return (
    <section className={`payment-grid-section ${mobileOpen ? "is-mobile-open" : ""}`} id="payment-grid" aria-labelledby="payment-grid-heading">
      <div className="grid-heading">
        <div>
            <h2 id="payment-grid-heading" tabIndex={-1}>Payment grid</h2>
          <p>Compare terms, rates, and down payments without rebuilding the deal.</p>
        </div>
        <button className="back-button" onClick={() => {
          if (window.matchMedia("(max-width: 800px)").matches) onMobileClose?.();
          else {
            const destination = document.getElementById("worksheet-heading");
            destination?.focus({ preventScroll: true });
            destination?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
          }
        }} type="button">
          <ArrowIcon direction="up" size={20} />
          Back to calculator
        </button>
      </div>

      {isStarting ? <div className="grid-empty"><GridIcon size={32} /><div><strong>One deal. Every payment option.</strong><p>Start with a selling price to compare terms, rates, and down payments.</p></div><button type="button" className="apply-button" onClick={onStartEstimate}>Enter selling price<ArrowIcon size={18} /></button></div> : null}
      <div className="grid-context" hidden={isStarting}>
        <span>{formatCurrency(dealInput.salePrice)} selling price</span>
        <span>{formatCurrency(result.amountBeforeCashDown)} before cash down</span>
      </div>

      {!isStarting ? <div className="grid-current-reference" role="region" aria-label="Current worksheet scenario">
        <strong>Current worksheet · Read-only reference</strong>
        <span>{dealInput.termMonths} months at {formatNumber(dealInput.apr)}% assumed annual interest rate</span>
        <span>{formatCurrency(dealInput.cashDown)} cash down</span>
        <span>{formatCurrency(result.monthlyPayment, { cents: true })}/mo estimated payment</span>
        <small>Edit grid assumptions, then select a payment to change the worksheet.</small>
      </div> : null}

      {!isStarting && allBlocked ? <div className="grid-readiness" role="status">
        <strong>No comparison is ready to apply</strong>
        <p>{blockedReason}</p>
        {onRepairEstimate ? <button className="grid-repair-button" type="button" onClick={() => onRepairEstimate(recoveryFieldId)}>Review worksheet<ArrowIcon size={18} /></button> : null}
      </div> : null}

      {!isMobile && !isStarting ? <div className="desktop-rate-grid">
        <table>
          <caption className="sr-only">
            Monthly payment estimates by loan term, interest rate, and total cash down
          </caption>
          <thead>
            <tr>
              <th scope="col">Term</th>
              <th scope="col">Rate</th>
              {grid.columns.map((column, columnIndex) => (
                <th key={`down-${columnIndex}`} scope="col">
                  <MoneyInput
                    id={`grid-down-${columnIndex}`}
                    ariaLabel={`Down payment column ${columnIndex + 1}`}
                    savedDraft={draftCache[`down-${columnIndex}`]}
                    onDraftChange={(draft) => setDraftCache((current) => ({ ...current, [`down-${columnIndex}`]: draft }))}
                    compact
                    onChange={(value) => onDownPaymentChange(columnIndex, value)}
                    value={downPayments[columnIndex]}
                  />
                  <span>down</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr className={dealInput.termMonths === row.termMonths ? "is-current-term" : ""} key={row.termMonths}>
                <th scope="row">{row.termMonths} mo</th>
                <td className="rate-cell">
                  <PercentInput
                    id={`grid-apr-${row.termMonths}`}
                    ariaLabel={`Interest rate for ${row.termMonths} months`}
                    savedDraft={draftCache[`apr-${row.termMonths}`]}
                    onDraftChange={(draft) => setDraftCache((current) => ({ ...current, [`apr-${row.termMonths}`]: draft }))}
                    onChange={(value) => onRateChange(row.termMonths, value)}
                    value={rates[row.termMonths]}
                  />
                </td>
                {row.cells.map((cell) => (
                  <td className={isSelected(cell) ? "is-selected" : ""} key={cell.key}>
                    <button
                      aria-label={`Use ${cell.termMonths} months at ${formatNumber(cell.apr)} percent with ${formatCurrency(cell.cashDown)} down for ${formatCurrency(cell.monthlyPayment)} per month`}
                      aria-pressed={isSelected(cell)}
                      disabled={isUnavailable(cell)}
                      onClick={() => apply(cell)}
                      type="button"
                    >
                      {formatCurrency(cell.monthlyPayment, { cents: true })}
                      {isSelected(cell) ? <span className="grid-selected-label">Selected</span> : null}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div> : null}

      {isMobile && !isStarting ? <div className="mobile-rate-grid">
        <section className="mobile-down-editor">
          <h3>Down payment amounts</h3>
          <p>Edit the total cash-down amounts to compare payments.</p>
          <div className="mobile-down-editor__grid">
            {downPayments.map((value, index) => (
              <MoneyInput
                id={`grid-down-${index}`}
                ariaLabel={`Down payment option ${index + 1}`}
                savedDraft={draftCache[`down-${index}`]}
                onDraftChange={(draft) => setDraftCache((current) => ({ ...current, [`down-${index}`]: draft }))}
                key={index}
                onChange={(next) => onDownPaymentChange(index, next)}
                value={value}
              />
            ))}
          </div>
        </section>
        <p className="mobile-grid-helper">Tap any payment to apply its term, interest rate, and down payment.</p>
        <div className="mobile-term-list">
          {grid.rows.map((row) => (
            <section className="mobile-term-card" key={row.termMonths}>
              <div className="mobile-term-card__header">
                <h3>{row.termMonths} months</h3>
                <label>
                  <span>Rate</span>
                  <PercentInput
                    id={`grid-apr-${row.termMonths}`}
                    ariaLabel={`Interest rate for ${row.termMonths} months`}
                    savedDraft={draftCache[`apr-${row.termMonths}`]}
                    onDraftChange={(draft) => setDraftCache((current) => ({ ...current, [`apr-${row.termMonths}`]: draft }))}
                    onChange={(value) => onRateChange(row.termMonths, value)}
                    value={rates[row.termMonths]}
                  />
                </label>
              </div>
              <div className="mobile-payment-options">
                {row.cells.map((cell) => (
                  <button
                    aria-label={`Use ${cell.termMonths} months at ${formatNumber(cell.apr)} percent with ${formatCurrency(cell.cashDown)} down for ${formatCurrency(cell.monthlyPayment, { cents: true })} per month`}
                    aria-pressed={isSelected(cell)}
                    disabled={isUnavailable(cell)}
                    className={isSelected(cell) ? "is-selected" : ""}
                    key={cell.key}
                    onClick={() => apply(cell)}
                    type="button"
                  >
                    <span>{formatCurrency(cell.cashDown)} down</span>
                    <strong>{formatCurrency(cell.monthlyPayment, { cents: true })}/mo</strong>
                    {isSelected(cell) ? <span className="grid-selected-label">Selected</span> : null}
                    <ArrowIcon direction="right" size={19} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div> : null}

      <div className="grid-footer" hidden={isStarting}>
        <div>
          <GridIcon size={22} />
          <strong>Payment grid</strong>
          <span>Compare terms, rates, and down payments</span>
        </div>
        <p>{allBlocked ? "Review the worksheet and comparison assumptions to enable a payment option." : "Select an available payment to apply its term, assumed annual interest rate, and down payment to the deal."}</p>
      </div>
    </section>
  );
}
