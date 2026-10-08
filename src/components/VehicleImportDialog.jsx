import { useEffect, useId, useRef } from 'react';
import { formatCurrency } from '../lib/formatters.js';

export default function VehicleImportDialog({ vehicle, error, hasDraftEdits, onAccept, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!dialogRef.current.open) dialogRef.current.showModal();
  }, []);
  return (
    <dialog aria-labelledby={titleId} className="settings-dialog vehicle-import" onClose={onClose} ref={dialogRef}>
      <div className="settings-dialog__form">
        <h2 id={titleId}>{error ? 'Vehicle import unavailable' : 'Review captured vehicle'}</h2>
        {error ? <p role="alert">{error}</p> : <>
          <p className="settings-dialog__note">Confirm the advertised price and any conditions with the listing. Taxes, fees, trade and financing are calculated in Payment Desk.</p>
          <dl className="vehicle-import__details">
            <div><dt>Vehicle / stock reference</dt><dd>{vehicle.vehicleDescription || 'Not provided'}</dd></div>
            <div><dt>Selling price</dt><dd>{vehicle.salePrice === null ? 'Not provided — enter it in the worksheet' : formatCurrency(vehicle.salePrice)}</dd></div>
          </dl>
          {hasDraftEdits ? <p className="vehicle-import__warning">Starting this estimate will clear the current deal figures, trade, products, targets and selected date. Your dealership settings stay saved.</p> : null}
        </>}
        <div className="settings-dialog__actions">
          <button className="settings-dialog__button" onClick={() => dialogRef.current.close()} type="button">{error ? 'Dismiss' : 'Cancel'}</button>
          {!error ? <button className="settings-dialog__button settings-dialog__button--primary" onClick={() => onAccept(vehicle)} type="button">Start new estimate</button> : null}
        </div>
      </div>
    </dialog>
  );
}
