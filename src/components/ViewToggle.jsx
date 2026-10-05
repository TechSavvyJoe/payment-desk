import { SegmentedControl } from "./Fields.jsx";
import { ResetIcon } from "./Icons.jsx";

export default function ViewToggle({ view, onViewChange, onReset }) {
  return (
    <header className="app-header">
      <a aria-label="Payment Desk home" className="brand" href="#worksheet-heading"
        onClick={(event) => { event.preventDefault(); onViewChange("dealer"); }}>
        <strong>PAYMENT DESK</strong>
      </a>
      <div className="header-actions">
        <SegmentedControl
          className="view-toggle"
          label="Calculator view"
          onChange={onViewChange}
          options={[
            { label: "Dealer view", value: "dealer" },
            { label: "Customer view", value: "customer" },
          ]}
          value={view}
        />
        <button aria-label="Reset deal" className="reset-button" onClick={onReset} type="button">
          <ResetIcon size={20} />
          <span>Reset deal</span>
        </button>
      </div>
    </header>
  );
}
