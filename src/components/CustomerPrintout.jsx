import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { fromCents } from '../lib/calculations.js';
import { formatCurrency, formatNumber, formatShortDate } from '../lib/formatters.js';

const money = amount => formatCurrency(amount, { cents: true });

// Measure unscaled content, including wrapping and loaded fonts. Widening the
// sheet before scaling preserves the full paper width and readable product rows.
function fitSheet(root) {
  if (!root) return;
  const sheet = root.querySelector('.customer-print-sheet');
  sheet.style.transform = 'none';
  const width = root.getBoundingClientRect().width - 1;
  const availableHeight = (252 / 25.4) * 96 - 2;
  const measure = scale => {
    sheet.style.width = `${width / scale}px`;
    return sheet.scrollHeight * scale;
  };
  let scale = 1;
  if (measure(scale) > availableHeight) {
    let low = 0.1;
    let high = 1;
    for (let step = 0; step < 14; step++) {
      const candidate = (low + high) / 2;
      if (measure(candidate) <= availableHeight) low = candidate;
      else high = candidate;
    }
    scale = low;
  }
  root.style.height = `${Math.ceil(measure(scale))}px`;
  sheet.style.transform = `scale(${scale})`;
  root.dataset.printScale = String(scale);
}

const PrintRow = ({ item, total = false }) => <div className={`print-row${total ? ' print-row--total' : ''}`}>
  <span>{item.label}</span><strong>{money(item.amount)}</strong>
</div>;

function PrintGroup({ group }) {
  return <section className="print-group">
    <h3>{group.title}</h3>
    {group.rows.map(item => <PrintRow key={item.id} item={item} />)}
    <PrintRow item={group.total} total />
  </section>;
}

export default function CustomerPrintout({ snapshot, result }) {
  const root = useRef(null);
  const { summary, groups } = snapshot;
  const { brand } = snapshot;
  const brandLine = brand.isCustom ? brand.dealershipName : brand.name;
  const transaction = groups.find(group => group.id === 'transaction');
  const productRows = transaction.rows.filter(item => item.id.startsWith('product-'));
  const purchaseRows = transaction.rows.filter(item => !item.id.startsWith('product-'));
  if (productRows.length) purchaseRows.splice(1, 0, {
    id: 'products-total', label: `Products & protection (${productRows.length})`,
    amount: fromCents(productRows.reduce((total, item) => total + item.cents, 0)),
  });
  const density = productRows.length > 18 ? 'dense' : productRows.length > 6 ? 'compact' : 'standard';

  useLayoutEffect(() => {
    let active = true;
    const fit = () => { if (active) fitSheet(root.current); };
    fit();
    document.fonts?.ready.then(fit);
    window.addEventListener('beforeprint', fit);
    return () => { active = false; window.removeEventListener('beforeprint', fit); };
  }, [snapshot]);

  return createPortal(<div className="customer-print-root" ref={root} aria-hidden="true">
    <article className={`customer-print-sheet print-density--${density}`}>
      <header className="print-masthead">
        <div className="print-brand">
          {brand.logo
            ? <img alt="" className="print-brand__logo" src={brand.logo} />
            : <img alt="" height="40" src="./payment-desk-icon.svg" width="40" />}
          <div>
            {brandLine ? <strong>{brandLine}</strong> : null}
            {brand.isCustom ? <span>PAYMENT DESK</span> : null}
          </div>
        </div>
        <div className="print-date"><span>ESTIMATE DATE</span><strong>{formatShortDate(snapshot.policy.dealDate)}</strong><small>Prepared {snapshot.createdLabel} ET</small></div>
      </header>
      <div className="print-title"><h1>Your vehicle estimate</h1><span>{summary.isFinanced ? 'FINANCE' : 'CASH'} ESTIMATE</span></div>
      {snapshot.vehicleReference ? <p className="print-vehicle"><span>VEHICLE / STOCK</span><strong>{snapshot.vehicleReference}</strong></p> : null}

      {!summary.canExport ? <section className="print-incomplete"><strong>INCOMPLETE ESTIMATE — DO NOT RELY ON THESE FIGURES</strong>{summary.reasons.map(reason => <p key={reason}>{reason}</p>)}</section> : null}

      <section className="print-hero">
        <svg className="print-hero-art" viewBox="0 0 720 120" preserveAspectRatio="none" aria-hidden="true"><rect width="720" height="120" rx="9" fill="#00095b" /><path d="M460 0H720V120H580Z" fill="#093c9b" /><path d="M650 0H720V120H705L590 0Z" fill="#066fef" opacity=".45" /></svg>
        <div className="print-payment"><h2>{summary.headline}</h2><p><strong>{money(summary.headlineAmount)}</strong>{summary.isFinanced ? <span>/mo</span> : null}</p><div>{summary.isFinanced ? `${summary.termMonths} months · ${formatNumber(summary.apr)}% APR` : summary.hasCashCredit ? "Amount in the customer's favor" : 'Includes trade payoff or equity'}</div></div>
        <dl className="print-key-totals">
          {summary.isFinanced ? <div><dt>Amount financed</dt><dd>{money(summary.amountFinanced)}</dd></div> : null}
          <div><dt>Out-the-door total</dt><dd>{money(summary.outTheDoor)}</dd></div>
          <div><dt>{summary.isFinanced ? 'Due at signing' : 'Cash due after trade'}</dt><dd>{money(summary.dueAtSigning)}</dd></div>
        </dl>
      </section>

      <div className="print-main-grid">
        <section className="print-purchase"><div className="print-section-heading"><h2><span>01</span> Your purchase</h2></div><PrintGroup group={{ ...transaction, title: 'Vehicle, taxes & fees', rows: purchaseRows }} />
          <div className="print-tax-credit"><span>Michigan trade tax savings</span><strong>{money(result.tradeTaxSavings)}</strong><p>{money(result.taxableTotalBeforeCredit)} taxable price − {money(result.tradeTaxDeduction)} trade deduction = {money(result.taxBase)} taxed.</p><p>{result.policy.year} trade deduction limit: {result.tradeTaxCreditCap === null ? 'no cap' : money(result.tradeTaxCreditCap)} · {formatNumber(result.salesTaxRate * 100)}% tax.</p></div>
        </section>
        <section><div className="print-section-heading"><h2><span>02</span> {summary.isFinanced ? 'Trade & financing' : 'Trade & cash settlement'}</h2></div>{groups.filter(group => group.id !== 'transaction').map(group => <PrintGroup key={group.id} group={group} />)}</section>
      </div>

      {productRows.length ? <section className="print-products"><div className="print-section-heading"><h2><span>03</span> Products & protection</h2><small>Included in your purchase above · T = taxable · NT = not taxable</small></div><ol>{productRows.map(item => {
        const taxable = !item.label.endsWith(' (not taxable)');
        const name = item.label.replace(/ \((?:not )?taxable\)$/, '');
        return <li key={item.id}><span className="print-product-name">{name}</span><div><strong>{money(item.amount)}</strong><span className="print-tax-label">{taxable ? 'T' : 'NT'}</span></div></li>;
      })}</ol></section> : null}

      {summary.isFinanced ? <section className="print-comparisons"><div className="print-section-heading"><h2><span>{productRows.length ? '04' : '03'}</span> Payment options</h2><small>Same deal and cash due · Subject to lender approval</small></div><div className="print-option-grid" style={{ gridTemplateColumns: `repeat(${snapshot.comparisonRows.length}, minmax(0, 1fr))` }}>{snapshot.comparisonRows.map(option => <div className={`print-option${option.selected ? ' print-option--selected' : ''}`} key={option.termMonths}>
        <div className="print-option-term">{option.termMonths} months <span>{option.selected ? 'SELECTED' : `${formatNumber(option.apr)}% APR`}</span></div><p><strong>{money(option.monthlyPayment)}</strong><span>/mo</span></p>{option.selected ? <small>{formatNumber(option.apr)}% APR</small> : null}
      </div>)}</div></section> : null}

      <footer className="print-qualification"><h2>Estimate assumptions</h2><ul>{snapshot.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul><p>{snapshot.qualification}</p><div className="print-document-reference"><span>{snapshot.reference} · App {snapshot.version}</span><strong>desking.mysoldlog.com</strong></div></footer>
    </article>
  </div>, document.body);
}
