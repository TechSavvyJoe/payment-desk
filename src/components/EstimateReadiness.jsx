export default function EstimateReadiness({ summary, onRepair, id, heading = 'Estimate needs attention', showReady = false }) {
  if (summary.canExport) return showReady ? <p className="estimate-ready"><span aria-hidden="true">✓</span> Ready for customer review</p> : null;
  return <section className="result-warning estimate-readiness" id={id} role="alert">
    <strong>{heading}</strong>
    {(summary.issues ?? summary.reasons.map(reason => ({ reason }))).map(issue => <div className="estimate-readiness__issue" key={`${issue.fieldId || ""}:${issue.reason}`}>
      <p>{issue.reason}</p>
      {onRepair && issue.fieldId ? <button type="button" onClick={() => onRepair(issue.fieldId)}>{issue.actionLabel}<span aria-hidden="true"> →</span></button> : null}
    </div>)}
  </section>;
}
