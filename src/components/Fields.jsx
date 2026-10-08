import { cloneElement, forwardRef, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { parseFinancialInput } from '../lib/inputValidation.js';
import { useFieldValidation } from './ValidationContext.jsx';
import { useInputDrafts } from './DraftContext.jsx';

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const isBlank = value => value === '' || value == null;

const FinancialInput = forwardRef(function FinancialInput({
  value, onChange, id, ariaLabel, className = '', disabled = false,
  min = 0, max, compact = false, kind = 'money', required = false, placeholder,
  savedDraft, onDraftChange, 'aria-describedby': describedBy,
}, ref) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const inputDrafts = useInputDrafts();
  const initialDraft = savedDraft ?? inputDrafts?.values[inputId];
  const [focused, setFocused] = useState(false);
  const editedWhileFocused = useRef(false);
  const [draft, setDraft] = useState(() => initialDraft?.raw ?? '');
  const [error, setError] = useState(() => initialDraft ? parseFinancialInput(initialDraft.raw, { kind, min, max, required }).error ?? null : null);
  const reportError = useFieldValidation();

  useEffect(() => {
    reportError?.(inputId, error);
    return () => reportError?.(inputId, null);
  }, [inputId, reportError, error]);

  const commit = raw => {
    const parsed = parseFinancialInput(raw, { kind, min, max, required });
    const message = parsed.error ?? null;
    onDraftChange?.({ raw, error: message });
    inputDrafts?.remember(inputId, raw);
    setError(message);
    reportError?.(inputId, message);
    if (!message) onChange?.(parsed.value);
    return parsed;
  };
  const formatted = isBlank(value) ? '' : kind === 'rate' ? Number(value).toFixed(2) : numberFormatter.format(value);
  return (
    <span className={`input-wrapper ${error ? 'is-invalid' : ''}`}>
      <span className={`${kind === 'money' ? 'money-input' : 'percent-input'} ${compact ? 'money-input--compact' : ''} ${className}`}>
        {kind === 'money' ? <span aria-hidden="true" className="money-input__prefix">$</span> : null}
        <input aria-label={ariaLabel} aria-invalid={error ? true : undefined} aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined}
          disabled={disabled} id={inputId} inputMode="decimal" min={min} placeholder={placeholder} required={required} ref={ref} type="text"
          value={focused || error ? draft : formatted}
          onFocus={event => {
            editedWhileFocused.current = false;
            setFocused(true);
            if (!error) setDraft(event.target.value);
            event.target.select();
          }}
          onChange={event => { editedWhileFocused.current = true; setDraft(event.target.value); commit(event.target.value); }}
          onBlur={event => {
            const parsed = parseFinancialInput(event.target.value, { kind, min, max, required });
            // Moving through an unchanged valid field must not create a saved edit.
            if (editedWhileFocused.current || parsed.error) commit(event.target.value);
            if (!parsed.error) setDraft(String(parsed.value));
            setFocused(false);
          }}
        />
        {kind === 'rate' ? <span aria-hidden="true" className="percent-input__suffix">%</span> : null}
      </span>
      {error ? <span className="field-error" id={errorId}>{error}</span> : null}
    </span>
  );
});

export const MoneyInput = forwardRef(function MoneyInput(props, ref) { return <FinancialInput {...props} ref={ref} />; });
export const PercentInput = props => <FinancialInput {...props} kind="rate" required={!props.disabled} />;

export function FieldRow({ label, htmlFor, children, helper, className = '' }) {
  const generatedId = useId();
  const helperId = `${htmlFor || generatedId}-help`;
  const control = helper && isValidElement(children) ? cloneElement(children, {
    'aria-describedby': [children.props['aria-describedby'], helperId].filter(Boolean).join(' '),
  }) : children;
  return (
    <div className={`field-row ${className}`}>
      <div className="field-row__label"><label htmlFor={htmlFor}>{label}</label>{helper ? <span id={helperId}>{helper}</span> : null}</div>
      {control}
    </div>
  );
}

export const SegmentedControl = ({ label, options, value, onChange, className = '' }) => (
  <div aria-label={label} className={`segmented ${className}`} role="group">
    {options.map(option => <button aria-pressed={value === option.value} className={value === option.value ? 'is-selected' : ''}
      key={option.value} onClick={() => onChange(option.value)} type="button">
      {option.shortLabel
        ? <><span className="segmented__full">{option.label}</span><span aria-hidden="true" className="segmented__short">{option.shortLabel}</span></>
        : option.label}
    </button>)}
  </div>
);
