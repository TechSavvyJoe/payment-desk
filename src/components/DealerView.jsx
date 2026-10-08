import { useEffect } from "react";
import { CALCULATION_DEFAULTS, RATE_GRID_DEFAULTS } from "../lib/calculations.js";
import { formatCurrency, formatWholeCurrency } from "../lib/formatters.js";
import DealSection from "./DealSection.jsx";
import { FieldRow, MoneyInput, PercentInput, SegmentedControl } from "./Fields.jsx";
import { AddCircleIcon, CarIcon, PercentIcon, PlusIcon, ReceiptIcon, TradeIcon, TrashIcon } from "./Icons.jsx";
import TargetSolver from "./TargetSolver.jsx";
import TradeTaxBreakdown from "./TradeTaxBreakdown.jsx";
import { useFieldValidation } from "./ValidationContext.jsx";

const categoryFor = (item) => item.category || (
  item.name === "Service Contract" ? "service-contract" : item.name === "Gap" ? "gap" : "other"
);

function OtherTaxField({ item, index, updateItem }) {
  const reportError = useFieldValidation();
  const inputId = `${item.id}-tax-treatment`;
  const error = Number(item.amount) > 0 && item.taxTreatmentConfirmed !== true ? "Choose the product's tax treatment." : null;
  useEffect(() => {
    reportError?.(inputId, error);
    return () => reportError?.(inputId, null);
  }, [inputId, error, reportError]);
  return (
    <label className="product-tax-label">
      <span>Tax treatment</span>
      <select className="product-tax-select" id={inputId}
        aria-label={`Tax treatment for ${item.name || `product or add-on ${index + 1}`}`}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-error` : undefined}
        value={item.taxTreatmentConfirmed === true ? item.taxable ? "taxable" : "not-taxable" : ""}
        onChange={(event) => updateItem(index, { taxable: event.target.value === "taxable", taxTreatmentConfirmed: event.target.value !== "" })}>
        <option value="">Choose tax treatment</option>
        <option value="taxable">Taxable</option>
        <option value="not-taxable">Not taxable</option>
      </select>
      {error ? <span className="field-error" id={`${inputId}-error`}>{error}</span> : null}
    </label>
  );
}

export default function DealerView({
  dealInput, result, updateField, updateItem, addItem, removeItem,
  accordions, toggleAccordion, targetProps, purchaseScope,
}) {
  const equitySummary = result.tradeEquity < 0
    ? `${formatWholeCurrency(Math.abs(result.tradeEquity))} negative equity`
    : result.tradeEquity > 0 ? `${formatWholeCurrency(result.tradeEquity)} trade equity` : "No trade equity";
  const taxesAndFees = result.salesTax + result.fees.totalFees;
  const changeCategory = (index, item, category) => {
    if (category === categoryFor(item)) return;
    updateItem(index, {
      category,
      name: category === "service-contract" ? "Service Contract" : category === "gap" ? "Gap" : "",
      taxable: false,
      taxTreatmentConfirmed: category !== "other",
    });
  };
  const addProduct = () => {
    addItem();
    requestAnimationFrame(() => {
      const controls = document.querySelectorAll(".product-category");
      controls[controls.length - 1]?.focus();
    });
  };
  const removeProduct = (index) => {
    removeItem(index);
    requestAnimationFrame(() => {
      const controls = document.querySelectorAll(".product-category");
      (controls[Math.min(index, controls.length - 1)] || document.getElementById("add-product"))?.focus();
    });
  };

  return (
    <main className="dealer-workspace" aria-label="Deal worksheet">
      <div className="worksheet-panel">
        <div className="deal-grid">
          <div className="deal-column">
          <DealSection id="vehicle" className="deal-section--vehicle" title="Vehicle" icon={CarIcon}
            open={accordions.vehicle} onToggle={() => toggleAccordion("vehicle")}
            summary={dealInput.salePrice === "" ? "Enter a price" : formatWholeCurrency(dealInput.salePrice)}>
            <FieldRow htmlFor="sale-price" label="Selling price" helper="Unknown? Use Roll to a target below.">
              <MoneyInput ariaLabel="Selling price" id="sale-price" value={dealInput.salePrice}
                onChange={(value) => updateField("salePrice", value)} />
            </FieldRow>
            <div className="choice-row">
              <span>Purchase type</span>
              <SegmentedControl label="Purchase type" value={dealInput.dealType}
                onChange={(value) => updateField("dealType", value)}
                options={[{ label: "Finance", value: "finance" }, { label: "Cash", value: "cash" }]} />
            </div>
          </DealSection>
          <DealSection id="trade-cash" className="deal-section--trade" title="Trade & cash" icon={TradeIcon}
            open={accordions.trade} onToggle={() => toggleAccordion("trade")} summary={result.isFinanced ? `${formatWholeCurrency(dealInput.cashDown)} down · ${equitySummary}` : equitySummary}>
            {result.isFinanced ? (
              <FieldRow htmlFor="cash-down" label="Cash down">
                <MoneyInput ariaLabel="Cash down" id="cash-down" value={dealInput.cashDown}
                  onChange={(value) => updateField("cashDown", value)} />
              </FieldRow>
            ) : null}
            <FieldRow htmlFor="trade-allowance" label="Trade allowance">
              <MoneyInput ariaLabel="Trade allowance" id="trade-allowance" value={dealInput.tradeAllowance}
                onChange={(value) => updateField("tradeAllowance", value)} />
            </FieldRow>
            <FieldRow htmlFor="trade-payoff" label="Trade payoff">
              <MoneyInput ariaLabel="Trade payoff" id="trade-payoff" value={dealInput.tradePayoff}
                onChange={(value) => updateField("tradePayoff", value)} />
            </FieldRow>
            <div className={`equity-line ${result.tradeEquity < 0 ? "is-negative" : "is-positive"}`}>
              <span>{result.tradeEquity < 0 ? "Negative equity" : "Trade equity"}</span>
              <strong>{formatCurrency(Math.abs(result.tradeEquity))}</strong>
            </div>
            {result.negativeEquity > 0 && result.isFinanced ? (
              <label className="equity-roll-control">
                <input checked={dealInput.rollNegativeEquity} type="checkbox"
                  onChange={(event) => updateField("rollNegativeEquity", event.target.checked)} />
                <span>Include negative equity in financing</span>
              </label>
            ) : null}
          </DealSection>
          {result.isFinanced ? (
            <section className="financing-panel" aria-labelledby="financing-heading">
              <div className="financing-panel__heading"><PercentIcon size={22} /><h2 id="financing-heading">Financing</h2></div>
              <div className="financing-panel__body">
                <FieldRow htmlFor="apr" label="Interest rate" helper="Assumed annual rate · up to 2 decimals">
                  <PercentInput ariaLabel="Annual interest rate" id="apr" value={dealInput.apr}
                    onChange={(value) => updateField("apr", value)} />
                </FieldRow>
                <div className="term-control">
                  <span>Term <small>(months)</small></span>
                  <div aria-label="Loan term" className="term-buttons" role="group">
                    {RATE_GRID_DEFAULTS.termMonths.map((term) => (
                      <button aria-pressed={dealInput.termMonths === term}
                        className={dealInput.termMonths === term ? "is-selected" : ""} key={term}
                        onClick={() => updateField("termMonths", term)} type="button">{term}</button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
          </div>
          <div className="deal-column">
          <DealSection id="taxes-fees" className="deal-section--taxes" title="Taxes & registration" icon={ReceiptIcon}
            open={accordions.taxes} onToggle={() => toggleAccordion("taxes")}
            summary={purchaseScope?.supported === false ? 'Rules unavailable' : `${formatWholeCurrency(taxesAndFees)} total`}>
            {purchaseScope?.supported === false ? <p className="scope-unavailable">{purchaseScope.reason}</p> : <>
            <TradeTaxBreakdown result={result} />
            <dl className="fixed-fees">
              <div><dt>Michigan sales tax <small>{CALCULATION_DEFAULTS.salesTaxRate * 100}%</small></dt><dd>{formatCurrency(result.salesTax)}</dd></div>
              <div><dt>Document fee <small>Taxable</small></dt><dd>{formatCurrency(result.fees.documentFee)}</dd></div>
              <div><dt>CRV fee <small>Taxable · store policy</small></dt><dd>{formatCurrency(result.fees.crvFee)}</dd></div>
            </dl>
            <div className="choice-row">
              <span>Registration</span>
              <SegmentedControl label="Plate type" value={dealInput.plateMode}
                onChange={(value) => updateField("plateMode", value)}
                options={[{ label: "Transfer", value: "transfer" }, { label: "New plate", value: "new" }]} />
            </div>
            {dealInput.plateMode === "new" ? (
              <FieldRow htmlFor="new-plate-amount" label="New plate amount"
                helper={`Enter registration estimate. Title ${formatCurrency(result.fees.titleFee)} added separately.`}>
                <MoneyInput ariaLabel="New plate amount" id="new-plate-amount" required value={dealInput.newPlateAmount}
                  onChange={(value) => updateField("newPlateAmount", value)} />
              </FieldRow>
            ) : (
              <p className="state-fee-line">Transfer {formatCurrency(result.fees.plateTransferFee)}
                {" · "}State fee {formatCurrency(result.fees.additionalTransferFee)}
                {" · "}Title {formatCurrency(result.fees.titleFee)}</p>
            )}
            </>}
          </DealSection>
          <DealSection id="products-addons" className="deal-section--products" title="Products & add-ons" icon={AddCircleIcon}
            open={accordions.roll} onToggle={() => toggleAccordion("roll")}
            summary={dealInput.optionalItems.length ? formatWholeCurrency(result.optionalItemsTotal) : "None selected"}>
            {!dealInput.optionalItems.length ? <div className="products-empty"><strong>Add only what belongs in this deal.</strong><p>Choose Service Contract, Gap, or Other, then enter the agreed amount.</p></div> : null}
            <div className="option-list">
              {dealInput.optionalItems.map((item, index) => (
                <div className="option-row" key={item.id}>
                  <label className="product-select-label">
                    <span>Product {index + 1}</span>
                    <select className="product-category" aria-label={`Product ${index + 1} type`}
                      value={categoryFor(item)} onChange={(event) => changeCategory(index, item, event.target.value)}>
                      <option value="service-contract">Service Contract</option>
                      <option value="gap">Gap</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  {categoryFor(item) === "other" ? (
                    <label className="product-name-label">
                      <span>Product name</span>
                      <input aria-label={`Product name for add-on ${index + 1}`} className="text-input"
                        value={item.name} placeholder="Describe the product" type="text" maxLength={120}
                        onChange={(event) => updateItem(index, { name: event.target.value })} />
                    </label>
                  ) : null}
                  <label className="product-amount-label">
                    <span>Amount</span>
                    <MoneyInput id={`product-${item.id}-amount`} ariaLabel={`${item.name || `Product ${index + 1}`} amount`} compact value={item.amount}
                      onChange={(value) => updateItem(index, { amount: value })} />
                  </label>
                  {categoryFor(item) === "other" ? <OtherTaxField item={item} index={index} updateItem={updateItem} /> : <label className="tax-check">
                    <input aria-label={`${item.name || `Product ${index + 1}`} is taxable`} type="checkbox"
                      checked={item.taxable} onChange={(event) => updateItem(index, { taxable: event.target.checked, taxTreatmentConfirmed: true })} />
                    <span>Taxable</span>
                  </label>}
                  <button aria-label={`Remove ${item.name || `product ${index + 1}`}`} className="icon-button product-remove"
                    onClick={() => removeProduct(index)} type="button"><TrashIcon size={18} /><span>Remove</span></button>
                </div>
              ))}
            </div>
            <button id="add-product" className="add-item-button" onClick={addProduct} type="button">
              <PlusIcon size={18} />Add product
            </button>
            <p className="section-note">Optional products only. Verify price, eligibility, and tax treatment.</p>
          </DealSection>
          </div>
        </div>
      </div>
      <TargetSolver dealInput={dealInput} result={result} {...targetProps} />
    </main>
  );
}
