import { useEffect, useId, useRef, useState } from 'react';
import { readCompanionInventory } from '../lib/companionInventory.js';
import { formatCurrency } from '../lib/formatters.js';
import { validateVehicle } from '../../extensions/payment-desk-companion/vehicleHandoff.js';

export default function InventoryPicker({ onClose, onChoose }) {
  const dialog = useRef(null);
  const titleId = useId();
  const searchId = useId();
  const conditionId = useId();
  const revision = useRef(null);
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState('');
  const [includeOld, setIncludeOld] = useState(false);
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { if (!dialog.current.open) dialog.current.showModal(); }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      readCompanionInventory({ query, condition, includeOld, offset, revision: offset > 0 ? revision.current : undefined }).then(page => {
        if (!cancelled) { revision.current = page.revision; setCatalog(page); setLoading(false); }
      }, failure => { if (!cancelled) { setError(failure.message); setLoading(false); } });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, condition, includeOld, offset, reload]);
  const changeFilter = (setter, value) => { revision.current = null; setter(value); setOffset(0); setLoading(true); setError(''); };
  const choose = vehicle => {
    const selection = validateVehicle({ version: 1, salePrice: vehicle.price,
      vehicleDescription: [vehicle.name.slice(0, 67), vehicle.stock ? `Stock ${vehicle.stock.slice(0, 24)}` : ''].filter(Boolean).join(' · '),
    });
    if (!selection) { setError('This vehicle reference could not be imported. Enter its details manually.'); return; }
    onChoose(selection);
  };
  return (
    <dialog aria-labelledby={titleId} className="settings-dialog inventory-picker" onClose={onClose} ref={dialog}>
      <div className="settings-dialog__form">
        <div className="inventory-picker__heading"><h2 id={titleId}>Dealership inventory</h2><button className="settings-dialog__button" onClick={() => dialog.current.close()} type="button">Close</button></div>
        <p className="settings-dialog__note">From the companion on this computer. Connect your dealership and refresh inventory in the Chrome panel. Review price and availability before starting a deal.</p>
        <div className="inventory-picker__filters">
          <label htmlFor={searchId}>Search vehicle, stock or VIN<input autoComplete="off" className="text-input" id={searchId} maxLength={80} onChange={event => changeFilter(setQuery, event.target.value)} type="search" value={query} /></label>
          <label htmlFor={conditionId}>Inventory<select id={conditionId} onChange={event => changeFilter(setCondition, event.target.value)} value={condition}><option value="">New and used</option><option value="new">New</option><option value="used">Used / certified</option></select></label>
        </div>
        <label className="inventory-picker__old"><input checked={includeOld} onChange={event => changeFilter(setIncludeOld, event.target.checked)} type="checkbox" />Include previously listed vehicles</label>
        <button className="settings-dialog__button" disabled={loading} onClick={() => { revision.current = null; setOffset(0); setError(''); setLoading(true); setReload(value => value + 1); }} type="button">Reload catalog</button>
        <div aria-live="polite" role="status">
          {loading ? <p>Reading companion inventory…</p> : error ? <p>{error}</p> : catalog ? <>
            <p>{catalog.site ? `${new URL(catalog.site).hostname} · ${catalog.total} matching vehicles` : 'No dealership connected. Open Inventory in the companion to connect your dealership website.'}</p>
            {catalog.site ? <p className="settings-dialog__hint">Last complete refresh: {catalog.lastCompletedAt ? new Date(catalog.lastCompletedAt).toLocaleString() : 'Not yet completed'}.{catalog.refreshing ? ' A refresh is in progress; these are the previously saved vehicles.' : ''}</p> : null}
            {catalog.error ? <p className="inventory-picker__warning">{catalog.error} Check last-seen dates before using cached vehicles.</p> : null}
            {catalog.nextOffset !== null && !catalog.revision ? <p className="inventory-picker__warning">Update the companion to browse the remaining vehicles safely.</p> : null}
          </> : null}
        </div>
        {!loading && !error && catalog?.vehicles.map(vehicle => <article className="inventory-picker__vehicle" key={vehicle.id}>
          <div className="inventory-picker__vehicle-heading"><h3>{vehicle.name}</h3><strong>{vehicle.price !== null ? formatCurrency(vehicle.price) : vehicle.websitePrice !== null ? `${formatCurrency(vehicle.websitePrice)} advertised` : 'Price unavailable'}</strong></div>
          <p>{[vehicle.condition, vehicle.stock && `Stock ${vehicle.stock}`, vehicle.mileage !== null && `${vehicle.mileage.toLocaleString()} mi`].filter(Boolean).join(' · ')}</p>
          <details><summary>Vehicle details</summary><p>{[vehicle.vin && `VIN ${vehicle.vin}`, vehicle.trim, vehicle.exterior, vehicle.interior, vehicle.transmission, vehicle.location].filter(Boolean).join(' · ')}</p><p>{vehicle.features.join(' · ')}</p><p>Last seen: {vehicle.lastSeenAt ? new Date(vehicle.lastSeenAt).toLocaleString() : 'Unknown'}. {vehicle.listed ? vehicle.availability : 'Not seen in the last complete refresh; confirm availability.'}</p></details>
          <p className="settings-dialog__hint">{vehicle.priceNote || 'Confirm selling price, discounts and availability.'}{vehicle.price === null ? ' Enter the verified selling price in the worksheet.' : ''}</p>
          <div className="inventory-picker__actions"><button className="settings-dialog__button settings-dialog__button--primary" onClick={() => choose(vehicle)} type="button">Use vehicle</button><a href={vehicle.url} rel="noopener noreferrer" target="_blank">View listing ↗</a></div>
        </article>)}
        {!loading && !error && catalog?.site && !catalog.vehicles.length ? <p>No matching vehicles. Adjust the filters or refresh inventory in the companion.</p> : null}
        {!loading && !error && catalog && (offset > 0 || catalog.nextOffset !== null) ? <div className="inventory-picker__actions">
          <button className="settings-dialog__button" disabled={offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 100)); setLoading(true); }} type="button">Previous vehicles</button>
          <button className="settings-dialog__button" disabled={catalog.nextOffset === null || !catalog.revision} onClick={() => { setOffset(catalog.nextOffset); setLoading(true); }} type="button">Next vehicles</button>
        </div> : null}
      </div>
    </dialog>
  );
}
