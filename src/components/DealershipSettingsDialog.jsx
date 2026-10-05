import { useEffect, useId, useRef, useState } from "react";
import { MAX_DEALERSHIP_NAME_LENGTH } from "../lib/brandSettings.js";
import { LogoError, prepareLogo } from "../lib/logoImage.js";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg";
const SAVE_FAILED = "Couldn't save on this device — storage is blocked or full. The dealership will show until this page is closed.";
const CLEAR_FAILED = "Couldn't remove the saved dealership on this device. It is hidden until this page is closed.";

/** Edits a draft of the dealership name and logo. Nothing changes until Save. */
export default function DealershipSettingsDialog({ settings, onSave, onClear, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState(settings.name);
  const [logo, setLogo] = useState(settings.logo);
  const [notice, setNotice] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [finished, setFinished] = useState(false);

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
    if (processing) return;
    const outcome = onSave({ name, logo });
    if (outcome.ok) { close(); return; }
    setFinished(true);
    setNotice({ tone: "error", text: SAVE_FAILED });
  };

  const clear = () => {
    if (!window.confirm("Clear the dealership name and logo on this device?")) return;
    const outcome = onClear();
    if (outcome.ok) { close(); return; }
    setName("");
    setLogo(null);
    setFinished(true);
    setNotice({ tone: "error", text: CLEAR_FAILED });
  };

  const removeLogo = () => {
    setLogo(null);
    setNotice({ tone: "info", text: "Logo removed. Select Save to keep this change." });
  };

  return (
    <dialog aria-labelledby={titleId} className="settings-dialog" onClose={onClose} ref={dialogRef}>
      <form className="settings-dialog__form" noValidate onSubmit={save}>
        <h2 id={titleId}>Dealership settings</h2>
        <p className="settings-dialog__note">Saved on this device only. Customer figures are never saved.</p>
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
            {logo ? <button className="settings-dialog__button" disabled={processing} onClick={removeLogo} type="button">Remove logo</button> : null}
          </div>
          <p className="settings-dialog__hint">PNG, JPG, WebP, GIF, or SVG up to 10 MB. Large logos are resized to fit 600 × 200 pixels.</p>
        </fieldset>
        <p aria-live="polite" className={"settings-dialog__notice" + (notice?.tone === "error" ? " is-error" : "")} role="status">{notice?.text ?? ""}</p>
        <div className="settings-dialog__actions">
          {!finished ? <button className="settings-dialog__button settings-dialog__button--danger" disabled={processing} onClick={clear} type="button">Clear dealership settings</button> : null}
          <span>
            <button className="settings-dialog__button" onClick={close} type="button">{finished ? "Done" : "Cancel"}</button>
            {!finished ? <button className="settings-dialog__button settings-dialog__button--primary" disabled={processing} type="submit">Save</button> : null}
          </span>
        </div>
      </form>
    </dialog>
  );
}
