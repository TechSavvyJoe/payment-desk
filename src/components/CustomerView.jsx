import { useId, useMemo, useState } from "react";
import { formatCurrency, formatNumber } from "../lib/formatters.js";
import { createProposalSnapshot, formatProposalText } from "../lib/proposal.js";
import { APP_VERSION, BUILD_ID } from "../lib/release.js";
import { EditIcon, PrintIcon, ShareIcon } from "./Icons.jsx";
import ResultsPanel from "./ResultsPanel.jsx";
import TradeTaxBreakdown from "./TradeTaxBreakdown.jsx";
import CustomerPrintout from "./CustomerPrintout.jsx";

const money = (value) => formatCurrency(value, { cents: true });
const LedgerRow = ({ item, total = false }) => (
  <div className={"customer-ledger__row" + (total ? " is-total" : "")}>
    <span>{item.label}</span><strong>{money(item.amount)}</strong>
  </div>
);

export default function CustomerView({ dealInput, result, gridRates, hasInputErrors = false, onEditDeal }) {
  const [createdAt] = useState(() => new Date().toISOString());
  const snapshot = useMemo(() => createProposalSnapshot({
    dealInput, result, gridRates, hasInputErrors, createdAt, version: APP_VERSION + " (" + BUILD_ID + ")",
  }), [dealInput, result, gridRates, hasInputErrors, createdAt]);
  const [status, setStatus] = useState("");
  const [copyFallback, setCopyFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const warningId = useId();
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const summaryText = () => formatProposalText(snapshot, { calculatorUrl: window.location.href });

  const handleCopy = async () => {
    if (!snapshot.summary.canExport || busy) return;
    setBusy(true);
    setCopyFallback(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(summaryText());
      setStatus("Complete estimate copied to clipboard.");
    } catch {
      setCopyFallback(true);
      setStatus("Automatic copy is unavailable. Select and copy the estimate text below.");
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    if (!snapshot.summary.canExport || busy || !canNativeShare) return;
    setBusy(true);
    try {
      // The text labels this as a generic calculator link, never a saved quote.
      await navigator.share({ title: snapshot.brand + " — " + snapshot.title, text: summaryText() });
      setStatus("Estimate shared.");
    } catch (error) {
      setStatus(error?.name === "AbortError" ? "Sharing canceled." : "Sharing is unavailable. Use Copy summary or Print instead.");
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => {
    if (!snapshot.summary.canExport) return;
    try { window.print(); }
    catch { setStatus("Printing is unavailable in this browser. Use Copy summary or open the calculator in a browser that supports printing."); }
  };

  return (
    <><div className="customer-layout">
      <main className="customer-content">
        <header className="proposal-identity">
          <p className="proposal-brand">{snapshot.brand}</p>
          <h2>{snapshot.title}</h2>
          {snapshot.vehicleReference ? <p className="proposal-vehicle">Vehicle / stock: {snapshot.vehicleReference}</p> : null}
          <p className="proposal-meta">Created {snapshot.createdLabel} Eastern time</p>
          <p className="proposal-meta">Reference {snapshot.reference}</p>
        </header>
        <div className="customer-actions">
          {onEditDeal ? <button className="edit-deal-button" onClick={onEditDeal} type="button"><EditIcon size={18} />Edit deal</button> : null}
          <button aria-describedby={!snapshot.summary.canExport ? warningId : undefined} className="share-button" disabled={!snapshot.summary.canExport || busy} onClick={handleCopy} type="button">Copy summary</button>
          {canNativeShare ? (
            <button aria-describedby={!snapshot.summary.canExport ? warningId : undefined} className="share-button" disabled={!snapshot.summary.canExport || busy} onClick={handleShare} type="button">
              <ShareIcon size={20} />Share
            </button>
          ) : null}
          <button aria-describedby={!snapshot.summary.canExport ? warningId : undefined} className="print-button" disabled={!snapshot.summary.canExport || busy} onClick={handlePrint} type="button">
            <PrintIcon size={19} />Print
          </button>
          <span className="share-status" role="status">{status}</span>
        </div>
        {!snapshot.summary.canExport ? (
          <section className="proposal-incomplete result-warning" id={warningId}>
            <h3>Complete the estimate before sharing or printing</h3>
            {snapshot.summary.reasons.map((reason) => <p key={reason}>{reason}</p>)}
          </section>
        ) : null}
        {copyFallback && snapshot.summary.canExport ? (
          <label className="proposal-copy-fallback">
            Copyable estimate summary
            <textarea onFocus={(event) => event.target.select()} readOnly rows={12} value={summaryText()} />
          </label>
        ) : null}
        <div className="proposal-ledgers">{snapshot.groups.map((section) => (
          <section className="customer-ledger" key={section.id}>
            <h2>{section.title}</h2>
            {section.rows.map((item) => <LedgerRow item={item} key={item.id} />)}
            <LedgerRow item={section.total} total />
            {section.id === 'transaction' ? <TradeTaxBreakdown result={result} /> : null}
          </section>
        ))}</div>
        {snapshot.summary.isFinanced ? (
          <section className="customer-options">
            <div className="customer-options__heading">
              <h2>Payment options</h2>
              <p>Same deal and cash due; rates are assumptions subject to lender approval.</p>
            </div>
            <div className="customer-options__table" role="table" aria-label="Customer payment options">
              <div className="customer-options__row is-header" role="row">
                <span role="columnheader">Term</span><span role="columnheader">APR</span><span role="columnheader">Monthly payment</span>
              </div>
              {snapshot.comparisonRows.map((option) => (
                <div className={"customer-options__row" + (option.selected ? " is-selected" : "")} key={option.termMonths} role="row">
                  <span role="cell">{option.termMonths} months{option.selected ? <strong className="selected-option-label"> ✓ Selected</strong> : null}</span>
                  <span role="cell">{formatNumber(option.apr)}%</span>
                  <span role="cell"><strong>{money(option.monthlyPayment)}/mo</strong></span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <footer className="proposal-qualification">
          <h2>Estimate assumptions</h2>
          <ul>{snapshot.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
          <p><strong>{snapshot.qualification}</strong></p>
          <p className="proposal-meta">{snapshot.brand} · {snapshot.reference} · App {snapshot.version}</p>
        </footer>
      </main>
      <ResultsPanel customer dealInput={dealInput} result={result} hasInputErrors={hasInputErrors} />
    </div><CustomerPrintout snapshot={snapshot} result={result} /></>
  );
}
