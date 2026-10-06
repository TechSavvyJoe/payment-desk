import { SegmentedControl } from "./Fields.jsx";
import { ResetIcon, SettingsIcon } from "./Icons.jsx";

export default function ViewToggle({ view, onViewChange, onReset, brand, onOpenSettings, settingsButtonRef }) {
  const custom = Boolean(brand?.isCustom);
  const homeLabel = brand?.dealershipName ? `${brand.dealershipName} Payment Desk home` : "Payment Desk home";
  const brandClass = ["brand", custom && "brand--custom", custom && brand.logo && "brand--has-logo"].filter(Boolean).join(" ");
  return (
    <header className="app-header">
      <a aria-label={homeLabel} className={brandClass} href="#worksheet-heading"
        onClick={(event) => { event.preventDefault(); onViewChange("dealer"); }}>
        {custom ? (
          <>
            {brand.logo ? <span className="brand__chip"><img alt={brand.dealershipName ? "" : "Dealership logo"} className="brand__logo" src={brand.logo} /></span> : null}
            <span className="brand__text">
              {brand.dealershipName ? <strong className="brand__name">{brand.dealershipName}</strong> : null}
              <span className="brand__credit">PAYMENT DESK</span>
            </span>
          </>
        ) : <strong>PAYMENT DESK</strong>}
      </a>
      <div className="header-actions">
        <SegmentedControl
          className="view-toggle"
          label="Calculator view"
          onChange={onViewChange}
          options={[
            { label: "Dealer view", shortLabel: "Dealer", value: "dealer" },
            { label: "Customer view", shortLabel: "Customer", value: "customer" },
          ]}
          value={view}
        />
        {view === "dealer" ? (
          // Reuses the header's .reset-button styling: icon-only below 800px, 38px wide below 440px.
          <button aria-label="Dealership settings" className="reset-button settings-button" onClick={onOpenSettings} ref={settingsButtonRef} type="button">
            <SettingsIcon size={20} />
            <span>Settings</span>
          </button>
        ) : null}
        <button aria-label="Reset deal" className="reset-button" onClick={onReset} type="button">
          <ResetIcon size={20} />
          <span>Reset deal</span>
        </button>
      </div>
    </header>
  );
}
