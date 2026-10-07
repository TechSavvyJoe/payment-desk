import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatShortDate, parseShortDate } from '../lib/formatters.js';
import { todayDealDate } from '../lib/policy.js';
import { useFieldValidation } from './ValidationContext.jsx';

export default function EstimateDateField({ value, onChange }) {
  const [draft, setDraft] = useState(() => formatShortDate(value));
  const [error, setError] = useState(null);
  // A blank desk can move to the new day after midnight. Show the new date in place,
  // so whoever is on this field keeps focus. A date being typed always matches value.
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if (parseShortDate(draft).value !== value) setDraft(formatShortDate(value));
  }
  const reportError = useFieldValidation();
  const calendar = useRef(null);
  const trigger = useRef(null);
  const pendingFocus = useRef(null);
  const [focusedDate, setFocusedDate] = useState(value);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    calendar.current?.querySelector(`[data-date="${pendingFocus.current}"]`)?.focus();
    pendingFocus.current = null;
  }, [focusedDate]);
  const displayed = new Date(`${focusedDate}T12:00:00Z`);
  const year = displayed.getUTCFullYear();
  const month = displayed.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dateFor = day => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const months = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))));
  const close = () => { pendingFocus.current = null; calendar.current.close(); trigger.current.focus(); };
  const choose = iso => { update(formatShortDate(iso)); close(); };
  const focusDay = iso => {
    if (iso < '2000-01-01' || iso > '2099-12-31') return;
    pendingFocus.current = iso;
    setFocusedDate(iso);
    // Existing days can receive the very next keystroke immediately. Month changes
    // finish focus in the layout effect, after their day buttons have rendered.
    calendar.current?.querySelector(`[data-date="${iso}"]`)?.focus();
  };
  const moveMonth = offset => {
    const next = new Date(Date.UTC(year, month + offset, 1)).toISOString().slice(0, 10);
    if (next >= '2000-01-01' && next <= '2099-12-31') setFocusedDate(next);
  };
  useEffect(() => () => reportError?.('estimate-date', null), [reportError]);
  const update = raw => {
    setDraft(raw);
    const parsed = parseShortDate(raw);
    const message = parsed.error ?? null;
    setError(message);
    reportError?.('estimate-date', message);
    if (!message) onChange(parsed.value);
  };
  return <div className="estimate-date-field"><label htmlFor="estimate-date">Estimate date <span id="estimate-date-hint">MM/DD/YY</span></label>
    <div className="estimate-date-control">
    <input id="estimate-date" type="text" value={draft} required maxLength={8} placeholder="MM/DD/YY" autoComplete="off"
      aria-label="Estimate date" aria-invalid={error ? true : undefined} aria-describedby={`estimate-date-hint${error ? ' estimate-date-error' : ''}`}
      onChange={event => update(event.target.value)} />
    <button className="calendar-trigger" type="button" ref={trigger} aria-label="Open estimate date calendar" aria-haspopup="dialog" onClick={() => {
      pendingFocus.current = value; setFocusedDate(value); calendar.current.showModal();
      calendar.current.querySelector(`[data-date="${value}"]`)?.focus();
    }}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18M7 15h3m4 0h3m-10 3h3"/></svg></button>
    </div>
    {error ? <span className="field-error" id="estimate-date-error">{error}</span> : null}
    <dialog className="date-calendar" ref={calendar} aria-labelledby="calendar-title" onClose={() => { pendingFocus.current = null; trigger.current?.focus(); }}>
      <div className="calendar-title"><div><span>DEAL DETAILS</span><h2 id="calendar-title">Choose estimate date</h2></div><button type="button" aria-label="Close calendar" onClick={close}>×</button></div>
      <div className="calendar-month">
        <button type="button" aria-label="Previous month" disabled={year === 2000 && month === 0} onClick={() => moveMonth(-1)}>‹</button>
        <select aria-label="Calendar month" value={month} onChange={event => setFocusedDate(`${year}-${String(Number(event.target.value) + 1).padStart(2, '0')}-01`)}>{months.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
        <select aria-label="Calendar year" value={year} onChange={event => setFocusedDate(`${event.target.value}-${String(month + 1).padStart(2, '0')}-01`)}>{Array.from({ length: 100 }, (_, index) => <option key={index} value={2000 + index}>{2000 + index}</option>)}</select>
        <button type="button" aria-label="Next month" disabled={year === 2099 && month === 11} onClick={() => moveMonth(1)}>›</button>
      </div>
      <p className="calendar-announcement" aria-live="polite">{months[month]} {year}</p>
      <div className="calendar-days" role="group" aria-label="Choose a day">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <span key={day} aria-hidden="true">{day}</span>)}
        {Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: dayCount }, (_, index) => {
          const iso = dateFor(index + 1);
          return <button key={iso} type="button" data-date={iso} tabIndex={iso === focusedDate ? 0 : -1}
            aria-label={new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))}
            aria-pressed={iso === value} aria-current={iso === todayDealDate() ? 'date' : undefined} onClick={() => choose(iso)} onFocus={() => setFocusedDate(iso)}
            onKeyDown={event => {
              const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -new Date(`${iso}T12:00:00Z`).getUTCDay(), End: 6 - new Date(`${iso}T12:00:00Z`).getUTCDay() };
              if (event.key in offsets) { event.preventDefault(); const next = new Date(`${iso}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + offsets[event.key]); focusDay(next.toISOString().slice(0, 10)); }
            }}>{index + 1}</button>;
        })}
      </div>
      <div className="calendar-footer"><span>Selected: {formatShortDate(value)}</span><button type="button" onClick={() => choose(todayDealDate())}>Today</button></div>
    </dialog>
  </div>;
}
