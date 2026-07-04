// variables.js — {{ variable }} template parsing, shared by the Text node's
// dynamic handles (TextNode.jsx) and the store's stale-edge pruning (store.js).

// Matches "{{ identifier }}" where identifier is shaped like a JS variable name.
export const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}/g;

// Reserved words match the identifier pattern but are not valid variable names.
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
  'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

// Extract unique valid variable names, preserving first-appearance order.
export const extractVariables = (text = '') => {
  const seen = new Set();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (!RESERVED.has(match[1])) {
      seen.add(match[1]);
    }
  }
  return [...seen];
};
