const statusText = status => status === 'saved' ? 'Draft saved on this device'
  : status === 'saving' ? 'Saving draft…'
    : status === 'conflict' ? 'Draft not saved · another tab changed it'
      : status === 'rejected' ? 'Saved draft needs recovery'
        : 'Draft not saved on this device';
const shortStatus = status => status === 'saved' ? 'Draft saved' : status === 'saving' ? 'Saving…'
  : status === 'rejected' ? 'Recovery needed' : 'Not saved';

export default function WorksheetToolbar({ title = 'Current worksheet', draftStatus, onSave, onOpen, onRecovery, saveButtonRef, libraryButtonRef }) {
  return <section className="worksheet-toolbar" aria-label="Worksheet introduction">
    <div className="worksheet-toolbar__identity">
      <h1 id="worksheet-heading" tabIndex={-1}>{title}</h1>
      <p className="worksheet-toolbar__status" role="status"><span className="worksheet-toolbar__full-status">{statusText(draftStatus)}</span><span className="worksheet-toolbar__short-status" aria-hidden="true">{shortStatus(draftStatus)}</span></p>
    </div>
    <div className="worksheet-toolbar__actions">
      <button className="worksheet-button" aria-label="Saved worksheets" type="button" ref={libraryButtonRef} onClick={onOpen}><span className="worksheet-toolbar__full-label">Saved worksheets</span><span className="worksheet-toolbar__short-label" aria-hidden="true">Worksheets</span></button>
      <button className="worksheet-button worksheet-button--primary" aria-label="Save worksheet" type="button" ref={saveButtonRef} onClick={onSave}><span className="worksheet-toolbar__full-label">Save worksheet</span><span className="worksheet-toolbar__short-label" aria-hidden="true">Save</span></button>
      {onRecovery ? <button className="worksheet-button" aria-label="Download recovery file" type="button" onClick={onRecovery}><span className="worksheet-toolbar__full-label">Download recovery file</span><span className="worksheet-toolbar__short-label" aria-hidden="true">Recovery</span></button> : null}
    </div>
  </section>;
}
