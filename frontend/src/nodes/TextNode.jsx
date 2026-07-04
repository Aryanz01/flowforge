// TextNode.jsx
// -----------------------------------------------------------------------------
// Text node. Built on the same BaseNode abstraction as every other node, plus:
//   1. The textarea auto-resizes — and the node widens — as the user types.
//   2. Valid JS identifiers wrapped in double curly braces (e.g. "{{ input }}")
//      each become a labeled target handle on the left side of the node.
// -----------------------------------------------------------------------------

import { useLayoutEffect, useRef } from 'react';
import { Type } from 'lucide-react';
import { createNode } from './BaseNode';
import { extractVariables } from '../variables';
import { useStore } from '../store';

// Grow the node's width with the longest line of text (within sane bounds).
const CHAR_WIDTH = 7.3; // approx px per character at 12.5px font
const textNodeWidth = (data) => {
  const longestLine = Math.max(
    0,
    ...(data?.text ?? '').split('\n').map((line) => line.length)
  );
  return Math.round(Math.min(Math.max(240, longestLine * CHAR_WIDTH + 80), 560));
};

const TextBody = ({ id, data, updateField }) => {
  const textareaRef = useRef(null);
  const pruneStaleVarEdges = useStore((s) => s.pruneStaleVarEdges);
  const text = data?.text ?? '';

  // Auto-grow height to fit content (width is handled by the node config).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [text]);

  return (
    <label className="ff-field">
      <span className="ff-field__label">Text</span>
      <textarea
        ref={textareaRef}
        className="ff-field__control ff-field__control--autosize nodrag"
        value={text}
        placeholder="Type here — use {{ variables }} to create inputs"
        rows={1}
        onChange={(e) => updateField('text', e.target.value)}
        onBlur={() => pruneStaleVarEdges(id)}
      />
    </label>
  );
};

const textNodeConfig = {
  title: 'Text',
  icon: Type,
  description: 'Compose text with {{ variables }}',
  // Dynamic handles: one target handle per {{ variable }} in the text.
  inputs: (id, data) =>
    extractVariables(data?.text ?? '').map((name) => ({
      id: `var-${name}`,
      label: name,
    })),
  outputs: [{ id: 'output', label: 'output' }],
  // `hidden` fields are seeded into the store but rendered by the custom body.
  fields: [{ key: 'text', default: '{{input}}', hidden: true }],
  body: TextBody,
  width: textNodeWidth,
};

export const TextNode = createNode(textNodeConfig);
