import { formatCurrency } from "../lib/formatters.js";
import { ArrowIcon, GridIcon } from "./Icons.jsx";

export default function MobileNav({ payment, onGrid, onPayment, hasEstimate = true }) {
  return (
    <nav aria-label="Mobile calculator shortcuts" className="mobile-nav">
      <button id="mobile-grid-trigger" onClick={onGrid} type="button">
        <GridIcon size={22} />
        <span>Payment grid</span>
        <ArrowIcon direction="right" size={18} />
      </button>
      <span aria-hidden="true" className="mobile-nav__divider" />
      <button aria-label={hasEstimate ? `View estimate, ${formatCurrency(payment, { cents: true })} per month` : undefined} className="mobile-nav__payment" onClick={onPayment} type="button">
        <strong>{hasEstimate ? `${formatCurrency(payment, { cents: true })}/mo` : 'Enter selling price'}</strong>
        <ArrowIcon direction="right" size={20} />
      </button>
    </nav>
  );
}
