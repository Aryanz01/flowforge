// RunDialog.jsx — modal asking for a value per input node before a run.
// Fully controlled by the caller: {open, inputNodes, onCancel, onRun(valuesById)}.

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';

export function RunDialog({ open, inputNodes, onCancel, onRun }) {
  const [values, setValues] = useState({});

  // Re-seed the form only on the closed→open transition. Depending on
  // inputNodes here would wipe in-progress typing whenever the parent
  // re-renders; the array is current at open time, which is all we need.
  useEffect(() => {
    if (!open) return;
    const initial = {};
    for (const node of inputNodes) initial[node.id] = node.data?.defaultValue || '';
    setValues(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="ff-overlay" onMouseDown={onCancel}>
      {/* stopPropagation so clicks inside the card don't hit the overlay's cancel */}
      <form
        className="ff-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onRun(values);
        }}
      >
        <h2 className="ff-dialog__title">Run pipeline</h2>
        <p className="ff-dialog__subtitle">Provide a value for each input node.</p>

        <div className="ff-dialog__fields">
          {inputNodes.map((node, index) => (
            <label className="ff-field" key={node.id}>
              <span className="ff-field__label">{node.data?.inputName || node.id}</span>
              <input
                className="ff-field__control"
                type="text"
                autoFocus={index === 0}
                value={values[node.id] ?? ''}
                onChange={(event) =>
                  setValues({ ...values, [node.id]: event.target.value })
                }
              />
            </label>
          ))}
        </div>

        <div className="ff-dialog__actions">
          <button type="button" className="ff-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="ff-btn ff-btn--primary">
            <Play size={14} /> Run
          </button>
        </div>
      </form>
    </div>
  );
}

