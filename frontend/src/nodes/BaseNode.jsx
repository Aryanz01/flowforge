// BaseNode.jsx
// -----------------------------------------------------------------------------
// The single node abstraction powering every node in FlowForge.
//
// A node is described by a plain config object instead of a bespoke component:
//
//   {
//     title:       'Input',                      // header label
//     icon:        LogIn,                        // lucide icon component
//     description: 'Pass data into the pipeline',
//     inputs:      [{ id: 'value', label: 'value' }]      // target handles (left)
//                  — or (id, data) => [...] for dynamic handles,
//     outputs:     [{ id: 'response', label: 'response' }], // source handles (right)
//     fields:      [{ key, label, type: 'text'|'select'|'textarea'|'number',
//                     options?, placeholder?, default?, hidden? }],
//     body:        OptionalCustomComponent,      // escape hatch for bespoke UI
//     width:       260 | (data) => number,       // optional width override
//   }
//
// Wrap a config with `createNode(config)` to get a ReactFlow-ready component.
// Field values live in the global zustand store (via updateNodeField), so the
// serialized pipeline sent to the backend always reflects what the user typed.
//
// FlowForge addition: each node subscribes to its own slice of
// `store.nodeStates` and reflects live execution status — running / done /
// error / skipped — plus an output-preview footer after node_finished.
// -----------------------------------------------------------------------------

import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals } from 'reactflow';
import { useStore } from '../store';

const DEFAULT_WIDTH = 240;
const PREVIEW_MAX = 160;

const resolveDefault = (field, id) =>
  typeof field.default === 'function' ? field.default(id) : field.default ?? '';

const resolve = (value, ...args) =>
  typeof value === 'function' ? value(...args) : value;

// Evenly distribute n handles along the node's height (as percentages).
const handleTop = (index, count) => `${((index + 1) / (count + 1)) * 100}%`;

// First value of the node's output dict, stringified and truncated for the
// footer strip (the backend already caps event previews at 200 chars).
const outputPreview = (output) => {
  const first = Object.values(output ?? {})[0];
  if (first === undefined) return '';
  const text = typeof first === 'string' ? first : JSON.stringify(first);
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
};

const Field = ({ field, value, onChange }) => {
  const common = {
    className: 'ff-field__control nodrag',
    value,
    onChange: (e) => onChange(field.key, e.target.value),
  };

  return (
    <label className="ff-field">
      <span className="ff-field__label">{field.label}</span>
      {field.type === 'select' ? (
        <select {...common}>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea {...common} rows={2} placeholder={field.placeholder} />
      ) : (
        <input {...common} type={field.type || 'text'} placeholder={field.placeholder} />
      )}
    </label>
  );
};

export const BaseNode = ({ id, data, selected, config }) => {
  const updateNodeField = useStore((state) => state.updateNodeField);
  const nodeState = useStore((state) => state.nodeStates[id]);
  const updateNodeInternals = useUpdateNodeInternals();

  const inputs = resolve(config.inputs, id, data) ?? [];
  const outputs = resolve(config.outputs, id, data) ?? [];
  const fields = config.fields ?? [];
  const width = resolve(config.width, data) ?? DEFAULT_WIDTH;

  // Seed default field values into the store so a freshly dropped node is
  // already fully represented in the serialized pipeline.
  useEffect(() => {
    fields.forEach((field) => {
      if (data?.[field.key] === undefined) {
        updateNodeField(id, field.key, resolveDefault(field, id));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When handles are dynamic (e.g. Text node variables) ReactFlow must be told
  // to re-measure the node, otherwise new handles won't accept connections.
  // A plain string key keeps the effect cheap: it re-runs only when the
  // handle list or width actually changes.
  const handleSignature =
    `${inputs.map((h) => h.id).join(',')}|${outputs.map((h) => h.id).join(',')}|${width}`;
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleSignature, updateNodeInternals]);

  const onFieldChange = (key, value) => updateNodeField(id, key, value);
  const Icon = config.icon;
  const Body = config.body;

  const status = nodeState?.status; // 'running' | 'done' | 'error' | 'skipped'
  const className = [
    'ff-node',
    selected ? 'ff-node--selected' : '',
    status ? `ff-node--${status}` : '',
  ].join(' ').trim();

  return (
    <div className={className} style={{ width }}>
      <div className="ff-node__header">
        {Icon && <span className="ff-node__icon"><Icon size={13} strokeWidth={2.2} /></span>}
        <span className="ff-node__title">{config.title}</span>
        {status === 'done' && nodeState.ms != null && (
          <span className="ff-node__ms">{nodeState.ms}ms</span>
        )}
      </div>

      {config.description && (
        <div className="ff-node__description">{config.description}</div>
      )}

      {(fields.length > 0 || Body) && (
        <div className="ff-node__body">
          {fields.filter((field) => !field.hidden).map((field) => (
            <Field
              key={field.key}
              field={field}
              value={data?.[field.key] ?? resolveDefault(field, id)}
              onChange={onFieldChange}
            />
          ))}
          {Body && <Body id={id} data={data} updateField={onFieldChange} />}
        </div>
      )}

      {status === 'error' && (
        <div className="ff-node__footer ff-node__footer--error">{nodeState.error}</div>
      )}
      {status === 'done' && nodeState.output && (
        <div className="ff-node__footer">{outputPreview(nodeState.output)}</div>
      )}

      {inputs.map((handle, i) => (
        <div key={handle.id}>
          <Handle
            type="target"
            position={Position.Left}
            id={`${id}-${handle.id}`}
            className="ff-handle"
            style={{ top: handleTop(i, inputs.length) }}
          />
          {handle.label && (
            <span
              className="ff-handle__label ff-handle__label--left"
              style={{ top: handleTop(i, inputs.length) }}
            >
              {handle.label}
            </span>
          )}
        </div>
      ))}

      {outputs.map((handle, i) => (
        <div key={handle.id}>
          <Handle
            type="source"
            position={Position.Right}
            id={`${id}-${handle.id}`}
            className="ff-handle"
            style={{ top: handleTop(i, outputs.length) }}
          />
          {handle.label && (
            <span
              className="ff-handle__label ff-handle__label--right"
              style={{ top: handleTop(i, outputs.length) }}
            >
              {handle.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

// Factory: turn a node config into a component ReactFlow can render.
export const createNode = (config) => {
  const NodeComponent = (props) => <BaseNode {...props} config={config} />;
  NodeComponent.displayName = `${config.title.replace(/\s/g, '')}Node`;
  return NodeComponent;
};
