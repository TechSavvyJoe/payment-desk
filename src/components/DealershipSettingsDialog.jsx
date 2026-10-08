import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MAX_DEALERSHIP_NAME_LENGTH } from "../lib/brandSettings.js";
import { CRV_FEE_MAXIMUM, DOCUMENT_FEE_MAXIMUM, FEE_DEFAULTS } from "../lib/feeSettings.js";
import { formatCurrency, formatNumber } from "../lib/formatters.js";
import { LogoError, prepareLogo } from "../lib/logoImage.js";
import { POLICY_CONFIG } from "../lib/policy.js";
import { MoneyInput } from "./Fields.jsx";
import { ValidationContext } from "./ValidationContext.jsx";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg";
const SAVE_FAILED = "Couldn't save on this device — storage is blocked or full. These settings apply until this page is closed.";
const CLEAR_FAILED = "Couldn't remove the saved settings on this device. Payment Desk and the default fees apply until this page is closed.";
const FEES_INVALID = "Correct the highlighted fee before saving.";
const DOCUMENT_FEE_HELP = `Michigan maximum ${formatCurrency(DOCUMENT_FEE_MAXIMUM)}; never more than ${POLICY_CONFIG.documentFeeSalePricePercent}% of the selling price`;
const CRV_FEE_HELP = "Taxable dealer fee";
const orBlank = (amount) => amount ?? "";
const orNull = (amount) => amount === "" || amount === undefined ? null : amount;

function FeeField({ label, helper, max, placeholder, value, onChange }) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="settings-dialog__fee">
      <label htmlFor={id}>{label}</label>
      <span className="settings-dialog__hint" id={helpId}>{helper}</span>
      <MoneyInput aria-describedby={helpId} id={id} max={max} onChange={onChange} placeholder={placeholder} value={value} />
    </div>
  );
}

/** Edits a draft of the dealership name, logo and fees. Nothing changes until Save. */
export default function DealershipSettingsDialog({ settings, feeSettings, onSave, onClear, onClose, externalChange = false }) {
  const dialogRef = useRef(null);
  const feesRef = useRef(null);
  const titleId = useId();
  const nameId = useId();
  const feesHintId = useId();
  const [name, setName] = useState(settings.name);
  const [logo, setLogo] = useState(settings.logo);
  const [documentFee, setDocumentFee] = useState(() => orBlank(feeSettings.documentFee));
  const [crvFee, setCrvFee] = useState(() => orBlank(feeSettings.crvFee));
  // Fee errors stay inside the dialog; the worksheet's validation banner never sees them.
  const [feeErrors, setFeeErrors] = useState({});
  const [feeFieldsKey, setFeeFieldsKey] = useState(0);
  const [notice, setNotice] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [finished, setFinished] = useState(false);
  const reportFeeError = useCallback((id, error) => setFeeErrors((current) => {
    if ((current[id] ?? null) === error) return current;
    const next = { ...current };
    if (error) next[id] = error; else delete next[id];
    return next;
  }), []);
  const hasFeeErrors = Object.keys(feeErrors).length > 0;
  // The save warning goes away once the fees are corrected.
  const shownNotice = notice?.text === FEES_INVALID && !hasFeeErrors ? null : notice;

  // Mounted only while open; the native modal supplies focus containment and Escape.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => dialogRef.current?.close();

  const chooseLogo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProcessing(true);
    setNotice({ tone: "info", text: "Preparing logo…" });
    try {
      setLogo(await prepareLogo(file));
      setNotice({ tone: "info", text: "Logo ready. Select Save to use it." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof LogoError ? error.message : "That logo couldn't be processed. Try a PNG or JPG." });
    } finally {
      setProcessing(false);
    }
  };

  const save = (event) => {
    event.preventDefault();
    if (processing || externalChange) return;
    if (hasFeeErrors) {
      [...(feesRef.current?.querySelectorAll("input") ?? [])].find((input) => feeErrors[input.id])?.focus();
      setNotice({ tone: "error", text: FEES_INVALID });
      return;
    }
    const outcome = onSave({ name, logo }, { documentFee: orNull(documentFee), crvFee: orNull(crvFee) });
    if (outcome.ok) { close(); return; }
    setFinished(true);
    setNotice({ tone: "error", text: outcome.persistence === "rollback-failed" ? "The saved settings could not be fully restored. Reload and check both dealership fees and branding before using another estimate." : SAVE_FAILED });
  };

  const clear = () => {
    if (externalChange) return;
    if (!window.confirm("Clear the dealership name, logo, and fees on this device? Fees return to the defaults.")) return;
    const outcome = onClear();
    if (outcome.ok) { close(); return; }
    setName("");
    setLogo(null);
    setDocumentFee("");
    setCrvFee("");
    // Remounting the fee fields drops any half-typed or invalid draft.
    setFeeFieldsKey((key) => key + 1);
    setFinished(true);
    setNotice({ tone: "error", text: outcome.persistence === "rollback-failed" ? "The saved settings could not be fully restored. Reload and check both dealership fees and branding before using another estimate." : CLEAR_FAILED });
  };

  const removeLogo = () => {
    setLogo(null);
    setNotice({ tone: "info", text: "Logo removed. Select Save to keep this change." });
  };

  return (
    <dialog aria-labelledby={titleId} className="settings-dialog" onClose={onClose} ref={dialogRef}>
      <form className="settings-dialog__form" noValidate onSubmit={save}>
        <h2 id={titleId}>Dealership settings</h2>
        {externalChange ? <p className="settings-dialog__note" role="alert">Settings changed in another tab. Close this dialog and reload before saving.</p> : null}
        <p className="settings-dialog__note">Saved on this device only. Reset deal clears the worksheet draft.</p>
        <div className="settings-dialog__field">
          <label htmlFor={nameId}>Dealership name <span>Optional</span></label>
          <input autoComplete="organization" className="text-input" disabled={finished} id={nameId} maxLength={MAX_DEALERSHIP_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)} placeholder="e.g. Lakeside Motors" type="text" value={name} />
        </div>
        <fieldset className="settings-dialog__logo" disabled={finished}>
          <legend>Logo <span>Optional</span></legend>
          <div className="settings-dialog__preview">
            {logo
              ? <span className="brand__chip"><img alt="Logo preview" className="brand__logo" src={logo} /></span>
              : <span>No logo selected</span>}
          </div>
          <div className="settings-dialog__logo-actions">
            <label className="settings-dialog__button settings-dialog__file">
              {logo ? "Replace logo" : "Choose logo"}
              <input accept={LOGO_ACCEPT} className="sr-only" disabled={processing || finished} onChange={chooseLogo} type="file" />
            </label>
            {logo ? <button className="settings-dialog__button" disabled={processing || externalChange} onClick={removeLogo} type="button">Remove logo</button> : null}
          </div>
          <p className="settings-dialog__hint">PNG, JPG, WebP, GIF, or SVG up to 10 MB. Large logos are resized to fit 600 × 200 pixels.</p>
        </fieldset>
        <ValidationContext.Provider value={reportFeeError}>
          <fieldset aria-describedby={feesHintId} className="settings-dialog__fees" disabled={finished} key={feeFieldsKey} ref={feesRef}>
            <legend>Fees</legend>
            <FeeField helper={DOCUMENT_FEE_HELP} label="Document fee" max={DOCUMENT_FEE_MAXIMUM} onChange={setDocumentFee}
              placeholder={formatNumber(FEE_DEFAULTS.documentFee)} value={documentFee} />
            <FeeField helper={CRV_FEE_HELP} label="CRV dealer fee" max={CRV_FEE_MAXIMUM} onChange={setCrvFee}
              placeholder={formatNumber(FEE_DEFAULTS.crvFee)} value={crvFee} />
            <p className="settings-dialog__hint" id={feesHintId}>Leave a fee blank to use the default shown.</p>
          </fieldset>
        </ValidationContext.Provider>
        <p aria-live="polite" className={"settings-dialog__notice" + (shownNotice?.tone === "error" ? " is-error" : "")} role="status">{shownNotice?.text ?? ""}</p>
        <div className="settings-dialog__actions">
          {!finished ? <button className="settings-dialog__button settings-dialog__button--danger" disabled={processing || externalChange} onClick={clear} type="button">Clear dealership settings</button> : null}
          <span>
            <button className="settings-dialog__button" onClick={close} type="button">{finished ? "Done" : "Cancel"}</button>
            {!finished ? <button className="settings-dialog__button settings-dialog__button--primary" disabled={processing || externalChange} type="submit">Save</button> : null}
          </span>
        </div>
      </form>
    </dialog>
  );
}
