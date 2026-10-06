import { CalendarIcon } from "./Icons.jsx";

/**
 * A slim, non-dismissible notice under the header while the tax and fee rules
 * near the end of their review window. Phones show a shorter version; screen
 * readers always get the full sentence.
 */
export default function PolicyReminder({ text, shortText }) {
  if (!text) return null;
  return (
    <div className="policy-reminder" role="note">
      <CalendarIcon className="policy-reminder__icon" size={18} />
      <p>
        <span className={shortText ? "policy-reminder__full" : undefined}>{text}</span>
        {shortText ? <span aria-hidden="true" className="policy-reminder__short">{shortText}</span> : null}
      </p>
    </div>
  );
}
