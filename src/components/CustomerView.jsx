import { useEffect, useId, useMemo, useState } from "react";
import { formatCurrency, formatNumber } from "../lib/formatters.js";
import { createProposalSnapshot, formatProposalText } from "../lib/proposal.js";
import { generateProposalPdf, canShareProposalPdf } from "../lib/proposalPdf.js";
import { APP_VERSION, BUILD_ID } from "../lib/release.js";
import { EditIcon, PrintIcon, ShareIcon } from "./Icons.jsx";
import ResultsPanel from "./ResultsPanel.jsx";
import TradeTaxBreakdown from "./TradeTaxBreakdown.jsx";
import CustomerPrintout from "./CustomerPrintout.jsx";
import EstimateReadiness from './EstimateReadiness.jsx';
import { PAYMENT_DESK_URL } from '../../extensions/payment-desk-companion/vehicleHandoff.js';

const money = (value) => formatCurrency(value, { cents: true });
const LedgerRow = ({ item, total = false }) => (
  <div className={"customer-ledger__row" + (total ? " is-total" : "")}>
    <span>{item.label}</span><strong>{money(item.amount)}</strong>
  </div>
);

export default function CustomerView({ dealInput, result, gridRates, hasInputErrors = false, onEditDeal, brand, onRepairEstimate, onAdjustPayments }) {
  const [createdAt] = useState(() => new Date().toISOString());
  const snapshot = useMemo(() => createProposalSnapshot({
    dealInput, result, gridRates, hasInputErrors, createdAt, brand, version: APP_VERSION + " (" + BUILD_ID + ")",
  }), [dealInput, result, gridRates, hasInputErrors, createdAt, brand]);
  // With a saved logo but no name, the logo alone identifies the dealership.
  const brandLine = snapshot.brand.isCustom ? snapshot.brand.dealershipName : snapshot.brand.name;
  const [status, setStatus] = useState("");
  const [copyFallback, setCopyFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const warningId = useId();
  const [prepared, setPrepared] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  const [pdfAttempt, setPdfAttempt] = useState(0);
  // Identity comparison disables exports during render, before effect cleanup runs.
  const currentPdf = prepared?.snapshot === snapshot ? prepared : null;
  const currentPdfError = pdfError?.snapshot === snapshot ? pdfError.message : '';
  const canNativeShare = canShareProposalPdf(currentPdf?.file);
  useEffect(() => {
    const controller = new AbortController();
    let url;
    if (snapshot.summary.canExport) {
      generateProposalPdf(snapshot, { signal: controller.signal }).then(file => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(file);
        setPrepared({ snapshot, file, url });
      }).catch(error => {
        if (!controller.signal.aborted) setPdfError({ snapshot, message: `PDF could not be generated: ${error.message}` });
      });
    }
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [snapshot, pdfAttempt]);
  const summaryText = () => formatProposalText(snapshot, { calculatorUrl: window.location.protocol === 'chrome-extension:' ? PAYMENT_DESK_URL : window.location.href });

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
    if (!snapshot.summary.canExport || busy || !canNativeShare || !currentPdf) return;
    setBusy(true);
    try {
      // Call synchronously in the click handler, before any await or generation.
      await navigator.share({ title: snapshot.brand.name + " — " + snapshot.title, files: [currentPdf.file] });
      setStatus("PDF passed to sharing app.");
    } catch (error) {
      setStatus(error?.name === "AbortError" ? "Sharing canceled." : "PDF sharing failed. Use Download PDF to save the file explicitly.");
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
      <section className="customer-content" aria-label="Itemized customer estimate">
        <header className="proposal-identity">
          {snapshot.brand.logo ? <img alt={brandLine ? "" : "Dealership logo"} className="proposal-logo" src={snapshot.brand.logo} /> : null}
          {brandLine ? <p className="proposal-brand">{brandLine}</p> : null}
          <h2>{snapshot.title}</h2>
          {snapshot.vehicleReference ? <p className="proposal-vehicle">Vehicle / stock: {snapshot.vehicleReference}</p> : null}
          <p className="proposal-meta">Created {snapshot.createdLabel} Eastern time</p>
          <p className="proposal-meta">Reference {snapshot.reference}</p>
        </header>
        <div className="customer-actions">
          {onEditDeal ? <button className="edit-deal-button" onClick={onEditDeal} type="button"><EditIcon size={18} />Edit deal</button> : null}
          <button aria-describedby={!snapshot.summary.canExport ? warningId : undefined} className="share-button export-secondary" disabled={!snapshot.summary.canExport || busy} onClick={handleCopy} type="button">Copy summary</button>
          {canNativeShare ? (
            <button aria-describedby={!snapshot.summary.canExport ? warningId : undefined} className="share-button" disabled={!snapshot.summary.canExport || busy} onClick={handleShare} type="button">
              <ShareIcon size={20} />Share PDF
            </button>
          ) : null}
          {currentPdfError ? <button className="share-button" type="button" onClick={() => {
            setPdfError(null); setPdfAttempt(attempt => attempt + 1);
          }}>Retry PDF</button> : null}
          <button className={`share-button${canNativeShare ? ' export-secondary' : ''}`} disabled={!currentPdf || !snapshot.summary.canExport || busy} type="button" onClick={() => {
            if (!currentPdf || !snapshot.summary.canExport) return;
            const link = document.createElement('a');
            link.href = currentPdf.url; link.download = currentPdf.file.name;
            link.click();
          }}>Download PDF</button>
          <button aria-describedby={!snapshot.summary.canExport ? warningId : undefined} className="print-button" disabled={!snapshot.summary.canExport || busy} onClick={handlePrint} type="button">
            <PrintIcon size={19} />Print
          </button>
          <span className="share-status" role="status">{status} {snapshot.summary.canExport ? (currentPdfError || (!currentPdf ? 'Preparing current PDF…' : !canNativeShare ? 'File sharing is unavailable. Use Download PDF.' : 'Current PDF ready.')) : null}</span>
        </div>
        {!snapshot.summary.canExport ? (
          <EstimateReadiness summary={snapshot.summary} onRepair={onRepairEstimate} id={warningId} heading="Complete the estimate before sharing or printing" />
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
              {onAdjustPayments ? <button className="adjust-payment-options" type="button" onClick={onAdjustPayments}><EditIcon size={17} />Adjust payment options</button> : null}
            </div>
            <div className="customer-options__table" role="table" aria-label="Customer payment options">
              <div className="customer-options__row is-header" role="row">
                <span role="columnheader">Term</span><span role="columnheader">Rate</span><span role="columnheader">Monthly payment</span>
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
          <p className="proposal-meta">{snapshot.brand.name} · {snapshot.reference} · App {snapshot.version}</p>
        </footer>
      </section>
      <ResultsPanel customer dealInput={dealInput} result={result} hasInputErrors={hasInputErrors} />
    </div><CustomerPrintout snapshot={snapshot} result={result} /></>
  );
}
