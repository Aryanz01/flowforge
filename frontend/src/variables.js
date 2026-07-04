// variables.js — {{ variable }} template parsing, shared by the Text node's
// dynamic handles (TextNode.jsx) and the store's stale-edge pruning (store.js).

// Matches "{{ identifier }}" where identifier is a valid JS variable name.
export const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}/g;

// Extract unique variable names, preserving first-appearance order.
export const extractVariables = (text = '') => {
  const seen = new Set();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    seen.add(match[1]);
  }
  return [...seen];
};
