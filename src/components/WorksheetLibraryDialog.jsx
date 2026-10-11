import { useEffect, useId, useRef, useState } from 'react';
import { formatCurrency, formatNumber, formatShortDate } from '../lib/formatters.js';

const ready = summary => summary?.ready === true;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const money = (summary, key) => ready(summary) && finite(summary[key]) ? formatCurrency(summary[key], { cents: true }) : '—';
const successful = outcome => outcome === true || outcome?.ok === true;
const dateText = value => {
  if (!value) return 'Not specified';
  try { return formatShortDate(value); } catch { return String(value); }
};
const savedDate = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { timeZone: 'America/Detroit', month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : 'Date unavailable';
};
const headline = summary => !ready(summary) ? 'Needs attention'
  : !summary.isFinanced && summary.customerCredit > 0
    ? `Estimated customer credit ${money(summary, finite(summary.payment) ? 'payment' : 'customerCredit')}`
    : `${money(summary, finite(summary.payment) ? 'payment' : 'cashDue')}${summary.isFinanced ? '/mo' : ''}`;
const terms = summary => ready(summary) && summary.isFinanced && finite(summary.termMonths) && finite(summary.apr)
  ? `${summary.termMonths} months / ${formatNumber(summary.apr)}% assumed APR` : '—';

function InlineAction({ action, worksheet, disabled, cancelDisabled, onCancel, onSubmit }) {
  const cancelRef = useRef(null);
  const nameRef = useRef(null);
  const nameId = useId();
  useEffect(() => {
    (action.type === 'rename' ? nameRef : cancelRef).current?.focus();
  }, [action.type]);
  return <form className="worksheet-row__confirmation" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    {action.type === 'rename' ? <label htmlFor={nameId}>Rename worksheet
      <input id={nameId} ref={nameRef} className="worksheet-input" required maxLength={80} pattern={'.*\\S.*'} value={action.name} disabled={disabled}
        onChange={event => action.onNameChange(event.target.value)} autoComplete="off" />
    </label> : <p><strong>{action.type === 'delete' ? 'Delete' : 'Replace'} “{worksheet.name}”?</strong>{' '}
      {action.type === 'delete' ? 'This removes the saved copy from this browser. The current worksheet stays open.' : 'Replace this saved copy with the current worksheet, including unfinished inputs. Its name stays the same.'}</p>}
    <div className="worksheet-row__confirmation-actions">
      <button ref={cancelRef} className="worksheet-button" disabled={cancelDisabled} type="button" onClick={onCancel}>Cancel</button>
      <button className={`worksheet-button ${action.type === 'delete' ? 'worksheet-button--danger' : 'worksheet-button--primary'}`} disabled={disabled} type="submit">
        {action.type === 'rename' ? 'Save name' : action.type === 'delete' ? 'Delete saved copy' : 'Replace saved copy'}
      </button>
    </div>
  </form>;
}

function Comparison({ entries }) {
  const rows = [
    ['Vehicle / stock', summary => summary?.vehicle || 'Not specified'],
    ['Estimate date', summary => dateText(summary?.date)],
    ['Status', summary => ready(summary) ? 'Ready for customer review' : summary?.reason || 'Needs attention'],
    ...(entries.some(entry => finite(entry.summary?.salePrice)) ? [['Selling price', summary => money(summary, 'salePrice')]] : []),
    ['Payment / cash due / credit', headline],
    ['Term / assumed APR', terms],
    ['Cash due at signing', summary => money(summary, 'cashDue')],
    ['Amount financed', summary => summary?.isFinanced ? money(summary, 'amountFinanced') : '—'],
    ['Out-the-door total', summary => money(summary, 'outTheDoor')],
    ['Estimated total interest', summary => summary?.isFinanced ? money(summary, 'totalInterest') : '—'],
  ];
  const vehicleReference = summary => {
    const value = summary?.vehicle?.trim() || '';
    return ['Vehicle not specified', 'Vehicle / stock not specified', 'Not specified'].includes(value) ? '' : value;
  };
  const reference = vehicleReference(entries[0].summary);
  const vehicleNote = summary => !vehicleReference(summary) || !reference ? 'Vehicle not verified'
    : vehicleReference(summary) !== reference ? 'Different vehicle reference' : null;
  return <>
    <table className="worksheet-comparison-table">
      <caption className="worksheet-visually-hidden">Current worksheet and selected saved worksheets, calculated using current fees and rules</caption>
      <thead><tr><th scope="col">Figures</th>{entries.map(entry => <th scope="col" key={entry.id}>{entry.name}
        {vehicleNote(entry.summary) ? <span className="worksheet-vehicle-note">{vehicleNote(entry.summary)}</span> : null}
      </th>)}</tr></thead>
      <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{entries.map(entry => <td key={entry.id}>{value(entry.summary)}</td>)}</tr>)}</tbody>
    </table>
    <div className="worksheet-comparison-cards">{entries.map(entry => <article className="worksheet-comparison-card" key={entry.id}>
      <h4>{entry.name}</h4>{vehicleNote(entry.summary) ? <p className="worksheet-vehicle-note">{vehicleNote(entry.summary)}</p> : null}
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value(entry.summary)}</dd></div>)}</dl>
    </article>)}</div>
  </>;
}

/** Storage and summary validation belong to the parent. All writes are explicit callbacks. */
export default function WorksheetLibraryDialog({ initialMode = 'browse', defaultName = '', currentSummary, worksheets = [], status, busy = false, message,
  onSaveCopy, onOpen, onUpdate, onRename, onDelete, onReload, onClose }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const nameRef = useRef(null);
  const actionTriggerRef = useRef(null);
  const titleId = useId();
  const helpId = useId();
  const searchId = useId();
  const nameId = useId();
  const selectionHelpId = useId();
  const comparisonId = useId();
  const [name, setName] = useState(() => defaultName.slice(0, 80));
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [action, setAction] = useState(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const pendingRef = useRef(false);
  const locked = busy || pending;
  const storageBlocked = ['conflict', 'error', 'rejected'].includes(status);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    (initialMode === 'save' ? nameRef : searchRef).current?.focus();
  }, [initialMode]);
  const selected = worksheets.filter(entry => selectedIds.includes(entry.id) && ready(entry.summary)).slice(0, 2);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = worksheets.filter(entry => `${entry.name} ${entry.summary?.vehicle || ''}`.toLocaleLowerCase().includes(normalizedQuery))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const cancelAction = () => {
    setAction(null);
    requestAnimationFrame(() => {
      (actionTriggerRef.current?.isConnected ? actionTriggerRef.current : searchRef.current)?.focus();
    });
  };
  const run = async (callback, successText, afterSuccess) => {
    if (locked || pendingRef.current || storageBlocked || !callback) return;
    pendingRef.current = true;
    setPending(true);
    setNotice('');
    try {
      const outcome = await callback();
      if (successful(outcome)) {
        setNotice(successText);
        afterSuccess?.();
      } else {
        setNotice(outcome?.message || 'The action was not completed. Your entered text and saved copies have been kept.');
      }
    } catch {
      setNotice('The action could not be completed. Your entered text and saved copies have been kept.');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const reload = async () => {
    if (locked || pendingRef.current || !onReload) return;
    pendingRef.current = true;
    setPending(true);
    setNotice('');
    try { await onReload(); } catch { setNotice('Saved worksheets could not be reloaded. Your current worksheet stays open.'); }
    finally { pendingRef.current = false; setPending(false); }
  };
  const requestClose = () => { if (!locked && !pendingRef.current) dialogRef.current?.close(); };
  const toggleSelected = entry => {
    if (locked || storageBlocked || !ready(entry.summary)) return;
    const activeIds = selected.map(item => item.id);
    setSelectedIds(activeIds.includes(entry.id) ? activeIds.filter(id => id !== entry.id) : activeIds.length < 2 ? [...activeIds, entry.id] : activeIds);
  };
  const submitAction = worksheet => {
    const callback = action.type === 'rename' ? () => onRename(worksheet.id, action.name.trim())
      : action.type === 'delete' ? () => onDelete(worksheet.id) : () => onUpdate(worksheet.id);
    void run(callback, action.type === 'rename' ? 'Worksheet renamed.' : action.type === 'delete' ? 'Saved copy deleted.' : 'Saved copy updated.', cancelAction);
  };

  return <dialog className="worksheet-library" ref={dialogRef} aria-labelledby={titleId} aria-describedby={helpId} aria-busy={locked}
    onCancel={event => { event.preventDefault(); requestClose(); }} onClose={onClose}>
    <header className="worksheet-library__header">
      <div><h2 id={titleId}>Saved worksheets</h2><p id={helpId}>Stored in this browser only. Opening recalculates with current fees and rules.</p></div>
      <button className="worksheet-button worksheet-library__close" aria-label="Close saved worksheets" type="button" disabled={locked} onClick={requestClose}>Close</button>
    </header>
    <div className="worksheet-library__body">
      <div className="worksheet-library__search"><label htmlFor={searchId}>Search worksheets</label>
        <input className="worksheet-input" id={searchId} ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} type="search" placeholder="Name or vehicle / stock reference" disabled={locked} />
      </div>
      <details className="worksheet-library__save-disclosure" open={initialMode === 'save'} onToggle={event => { if (event.currentTarget.open) nameRef.current?.focus(); }}>
      <summary>Save current worksheet</summary>
      <form className="worksheet-library__save" onSubmit={event => { event.preventDefault(); void run(() => onSaveCopy(name.trim()), 'A named copy was saved on this device.'); }}>
        <label htmlFor={nameId}>Worksheet name<input className="worksheet-input" id={nameId} ref={nameRef} autoComplete="off" required maxLength={80} pattern={'.*\\S.*'}
          disabled={locked || storageBlocked} value={name} onChange={event => setName(event.target.value)} placeholder="Vehicle / stock · alternative name" /></label>
        <button className="worksheet-button worksheet-button--primary" type="submit" disabled={locked || storageBlocked || worksheets.length >= 50}>Save a copy</button>
        <p>Saved copies change only when you choose Update with current worksheet.{worksheets.length >= 50 ? ' The 50-copy limit is reached; delete a copy to make room.' : ''}</p>
      </form>
      </details>
      <div className={`worksheet-library__notice${storageBlocked ? ' worksheet-library__notice--error' : ''}`} role="status">
        {locked ? 'Working…' : message || notice || (storageBlocked ? 'Saved worksheets are unavailable. Reload the list to try again; the current worksheet stays open.' : '')}
        {storageBlocked && onReload ? <button className="worksheet-button" disabled={locked} type="button" onClick={reload}>Reload list</button> : null}
      </div>
      <section className="worksheet-library__list" aria-labelledby={`${titleId}-list`}>
        <div className="worksheet-library__section-heading"><h3 id={`${titleId}-list`}>Your saved worksheets</h3><span>{worksheets.length} of 50 · newest first</span></div>
        <p id={selectionHelpId}>Select up to two ready worksheets to compare with the current worksheet.</p>
        {!filtered.length ? <p className="worksheet-library__empty">{worksheets.length ? 'No worksheets match this search.' : storageBlocked ? 'The saved list could not be read.' : 'No saved worksheets yet. Name the current worksheet above to keep a copy.'}</p> : null}
        {filtered.map(worksheet => {
          const checked = selected.some(entry => entry.id === worksheet.id);
          const activeAction = action?.id === worksheet.id;
          return <article className={`worksheet-row${checked ? ' worksheet-row--selected' : ''}`} key={worksheet.id}>
            <div className="worksheet-row__main">
              <label className="worksheet-row__select"><input type="checkbox" checked={checked} onChange={() => toggleSelected(worksheet)} aria-describedby={selectionHelpId}
                disabled={locked || storageBlocked || !ready(worksheet.summary) || (!checked && selected.length >= 2)} aria-label={`Compare ${worksheet.name}`} /></label>
              <div className="worksheet-row__identity"><h4>{worksheet.name}</h4><p>{worksheet.summary?.vehicle || 'Vehicle / stock not specified'}</p>
                <p className="worksheet-row__saved">Saved {savedDate(worksheet.updatedAt)}</p>
              </div>
              <div className="worksheet-row__metrics"><strong>{headline(worksheet.summary)}</strong>
                {ready(worksheet.summary) ? <><span>{worksheet.summary.isFinanced ? terms(worksheet.summary) : worksheet.summary.label || 'Cash purchase'}</span><span>At signing {money(worksheet.summary, 'cashDue')}</span></>
                  : <span>{worksheet.summary?.reason || 'Complete the worksheet before comparing.'}</span>}
              </div>
              <div className="worksheet-row__actions">
                <button className="worksheet-button" type="button" disabled={locked || storageBlocked} onClick={() => void run(() => onOpen(worksheet.id), 'Worksheet opened.')}>Open</button>
                <details className="worksheet-row__more"><summary aria-label={`More actions for ${worksheet.name}`}>More</summary>
                  <div>{[['rename', 'Rename'], ['update', 'Update with current worksheet'], ['delete', 'Delete']].map(([type, label]) => <button className="worksheet-button" type="button" key={type} disabled={locked || storageBlocked}
                    onClick={event => { actionTriggerRef.current = event.currentTarget.closest('details').querySelector('summary'); event.currentTarget.closest('details').open = false; setAction({ id: worksheet.id, type, name: worksheet.name }); }}>{label}</button>)}</div>
                </details>
              </div>
            </div>
            {activeAction ? <InlineAction key={`${worksheet.id}-${action.type}`} worksheet={worksheet} disabled={locked || storageBlocked} cancelDisabled={locked} action={{ ...action, onNameChange: value => setAction(current => ({ ...current, name: value })) }} onCancel={cancelAction} onSubmit={() => submitAction(worksheet)} /> : null}
          </article>;
        })}
      </section>
      <section className="worksheet-library__comparison" aria-labelledby={comparisonId}>
        <h3 id={comparisonId}>Compare worksheets</h3>
        <p>Calculated with current dealership fees and rules; saved estimate dates are retained. Vehicle references may differ.</p>
        {selected.length ? <><p className="worksheet-library__selection" role="status">Selected: {selected.map(entry => entry.name).join('; ')}.</p>
          <Comparison entries={[{ id: 'current', name: 'Current worksheet', summary: currentSummary }, ...selected]} />
        </> : <p className="worksheet-library__empty">Select a ready saved worksheet above to see its figures beside the current worksheet.</p>}
        <p className="worksheet-library__qualification">Estimates only. Rates are assumptions, not financing approvals. Confirm payments, taxes, fees and eligibility with the dealership’s approved systems.</p>
      </section>
    </div>
    <footer className="worksheet-library__footer"><span>{selected.length} of 2 saved worksheets selected{locked ? ' · Working…' : ''}</span>
      <button className="worksheet-button" type="button" disabled={locked} onClick={requestClose}>Close</button>
    </footer>
  </dialog>;
}
