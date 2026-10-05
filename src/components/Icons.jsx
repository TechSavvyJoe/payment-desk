
const Icon = ({ children, size = 22, className = "", ...props }) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    {...props}
  >
    {children}
  </svg>
);

export const ResetIcon = (props) => (
  <Icon {...props}>
    <path d="M4.8 7.7A8 8 0 1 1 4 15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
    <path d="M4.7 3.9v4.2h4.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
  </Icon>
);

export const EditIcon = (props) => (
  <Icon {...props}>
    <path d="m14.8 5.1 4.1 4.1M4.7 19.3l3.8-.8L19.2 7.8a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L5.5 15.5l-.8 3.8Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
  </Icon>
);

export const TrashIcon = (props) => (
  <Icon {...props}>
    <path d="M5.5 7.2h13M9 7.2V4.8h6v2.4m2 0-.7 12H7.7L7 7.2m3.2 3.1v5.9m3.6-5.9v5.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </Icon>
);

export const PlusIcon = (props) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
  </Icon>
);

export const ChevronIcon = ({ direction = "down", ...props }) => {
  const rotation = { down: 0, up: 180, left: 90, right: -90 }[direction] ?? 0;
  return (
    <Icon {...props} style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="m5.5 9 6.5 6 6.5-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </Icon>
  );
};

export const ArrowIcon = ({ direction = "right", ...props }) => {
  const rotation = { right: 0, down: 90, left: 180, up: -90 }[direction] ?? 0;
  return (
    <Icon {...props} style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
    </Icon>
  );
};

export const GridIcon = (props) => (
  <Icon {...props}>
    <rect height="6" rx=".8" stroke="currentColor" strokeWidth="1.8" width="6" x="3" y="3" />
    <rect height="6" rx=".8" stroke="currentColor" strokeWidth="1.8" width="6" x="15" y="3" />
    <rect height="6" rx=".8" stroke="currentColor" strokeWidth="1.8" width="6" x="3" y="15" />
    <rect height="6" rx=".8" stroke="currentColor" strokeWidth="1.8" width="6" x="15" y="15" />
  </Icon>
);

export const CarIcon = (props) => (
  <Icon {...props}>
    <path d="m5.5 9 1.6-3.4A2 2 0 0 1 8.9 4.5h6.2a2 2 0 0 1 1.8 1.1L18.5 9m-13 0h13a2 2 0 0 1 2 2v6.2H3.5V11a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M6.5 17.2v2.3m11-2.3v2.3M7.2 13h.1m9.4 0h.1" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
  </Icon>
);

export const TradeIcon = (props) => (
  <Icon {...props}>
    <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4 4-4-4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </Icon>
);

export const ReceiptIcon = (props) => (
  <Icon {...props}>
    <path d="M6 3.5h12v17l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2v-17Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M9 8h6m-6 4h6m-6 4h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
  </Icon>
);

export const PercentIcon = (props) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="17" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    <path d="m18.5 4.5-13 15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
  </Icon>
);

export const TargetIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
  </Icon>
);

export const AddCircleIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 7.5v9M7.5 12h9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
  </Icon>
);

export const ShareIcon = (props) => (
  <Icon {...props}>
    <path d="M12 15V3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
    <path d="m7.5 7.5 4.5-4.5 4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
    <path
      d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
    />
  </Icon>
);

export const PrintIcon = (props) => (
  <Icon {...props}>
    <path d="M7 9V4h10v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    <rect height="7" rx="1.4" stroke="currentColor" strokeWidth="1.8" width="16" x="4" y="9" />
    <path d="M7 14h10v6H7z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
  </Icon>
);

export const SettingsIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.9" />
    <circle cx="12" cy="12" r="6.6" stroke="currentColor" strokeWidth="1.9" />
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
  </Icon>
);
