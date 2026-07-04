// ResultsPanel.jsx — floating bottom-right card showing run status and the
// pipeline's final outputs. Hidden while runStatus is 'idle'.

import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { useStore } from '../store';

export function ResultsPanel() {
  const runStatus = useStore((s) => s.runStatus);
  const finalOutputs = useStore((s) => s.finalOutputs);
  const runMs = useStore((s) => s.runMs);
  const runError = useStore((s) => s.runError);
  const resetRun = useStore((s) => s.resetRun);

  if (runStatus === 'idle') return null;

  const outputs = Object.entries(finalOutputs || {});

  return (
    <div className="ff-results">
      <button className="ff-results__close" onClick={resetRun} aria-label="Close results">
        <X size={14} />
      </button>

      {runStatus === 'running' && (
        <div className="ff-results__status ff-results__status--running">
          <Loader2 size={15} className="ff-spin" /> Running pipeline…
        </div>
      )}
      {runStatus === 'done' && (
        <div className="ff-results__status ff-results__status--done">
          <CheckCircle2 size={15} /> Run complete · {runMs} ms
        </div>
      )}
      {runStatus === 'error' && (
        <div className="ff-results__status ff-results__status--error">
          <AlertCircle size={15} /> Run failed
        </div>
      )}
      {runStatus === 'error' && runError && (
        <p className="ff-results__error">{runError}</p>
      )}

      {outputs.length > 0 && (
        <div className="ff-results__outputs">
          {outputs.map(([key, value]) => (
            <div className="ff-results__row" key={key}>
              <span className="ff-results__key">{key}</span>
              <span className="ff-results__value">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

