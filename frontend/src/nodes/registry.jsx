// registry.jsx
// -----------------------------------------------------------------------------
// Single source of truth for every node type: config objects (rendered by
// BaseNode) plus the two derived exports the rest of the app consumes —
//   nodeTypes:     the ReactFlow `nodeTypes` map ({ type: Component })
//   paletteGroups: what the sidebar palette renders (grouped drag chips)
// Type keys, data fields, and handle ids match the CONTRACTS.md node table.
// -----------------------------------------------------------------------------

import {
  LogIn, LogOut, Type, Sparkles, Globe, GitBranch, Calculator, Timer, StickyNote,
} from 'lucide-react';
import { createNode } from './BaseNode';
import { TextNode } from './TextNode';

const InputNode = createNode({
  title: 'Input',
  icon: LogIn,
  description: 'Pass data into the pipeline',
  fields: [
    // Seed a readable unique name from the node id, e.g. input-2 → input_2.
    { key: 'inputName', label: 'Name', type: 'text', default: (id) => id.replace('input-', 'input_') },
    { key: 'defaultValue', label: 'Default value', type: 'text', placeholder: 'Used when run input is empty' },
  ],
  outputs: [{ id: 'value', label: 'value' }],
});

const OutputNode = createNode({
  title: 'Output',
  icon: LogOut,
  description: 'Expose a pipeline result',
  fields: [
    { key: 'outputName', label: 'Name', type: 'text', default: (id) => id.replace('output-', 'output_') },
  ],
  inputs: [{ id: 'value', label: 'value' }],
});

const LlmNode = createNode({
  title: 'LLM',
  icon: Sparkles,
  description: 'Query a language model',
  fields: [
    {
      key: 'model',
      label: 'Model',
      type: 'select',
      options: ['mock', 'gemini-flash', 'claude-haiku-4-5', 'claude-sonnet-4-6'],
      default: 'mock',
    },
  ],
  inputs: [
    { id: 'system', label: 'system' },
    { id: 'prompt', label: 'prompt' },
  ],
  outputs: [{ id: 'response', label: 'response' }],
});

const ApiRequestNode = createNode({
  title: 'API Request',
  icon: Globe,
  description: 'Call an HTTP endpoint',
  fields: [
    { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST'], default: 'GET' },
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com' },
  ],
  inputs: [{ id: 'body', label: 'body' }],
  outputs: [{ id: 'response', label: 'response' }],
});

const ConditionNode = createNode({
  title: 'Condition',
  icon: GitBranch,
  description: 'Route the value down one branch',
  fields: [
    {
      key: 'operator',
      label: 'Operator',
      type: 'select',
      options: ['==', '!=', '>', '<', '>=', '<=', 'contains'],
      default: '==',
    },
    { key: 'compareTo', label: 'Compare to', type: 'text', placeholder: 'Value to compare against' },
  ],
  inputs: [{ id: 'value', label: 'value' }],
  outputs: [
    { id: 'true', label: 'true' },
    { id: 'false', label: 'false' },
  ],
});

const MathNode = createNode({
  title: 'Math',
  icon: Calculator,
  description: 'Combine two numbers',
  fields: [
    {
      key: 'operation',
      label: 'Operation',
      type: 'select',
      options: ['Add', 'Subtract', 'Multiply', 'Divide'],
      default: 'Add',
    },
  ],
  inputs: [
    { id: 'a', label: 'a' },
    { id: 'b', label: 'b' },
  ],
  outputs: [{ id: 'result', label: 'result' }],
});

const DelayNode = createNode({
  title: 'Delay',
  icon: Timer,
  description: 'Wait, then pass the value through',
  fields: [
    { key: 'duration', label: 'Duration (ms)', type: 'number', default: '1000' },
  ],
  inputs: [{ id: 'in', label: 'in' }],
  outputs: [{ id: 'out', label: 'out' }],
});

const NoteNode = createNode({
  title: 'Note',
  icon: StickyNote,
  description: 'Annotation — ignored at runtime',
  fields: [
    { key: 'note', label: 'Note', type: 'textarea', placeholder: 'Write a note…' },
  ],
});

export const nodeTypes = {
  input: InputNode,
  output: OutputNode,
  text: TextNode,
  llm: LlmNode,
  apiRequest: ApiRequestNode,
  condition: ConditionNode,
  math: MathNode,
  delay: DelayNode,
  note: NoteNode,
};

export const paletteGroups = [
  {
    category: 'Core',
    items: [
      { type: 'input', label: 'Input', icon: LogIn },
      { type: 'output', label: 'Output', icon: LogOut },
      { type: 'text', label: 'Text', icon: Type },
      { type: 'llm', label: 'LLM', icon: Sparkles },
    ],
  },
  {
    category: 'Logic',
    items: [
      { type: 'condition', label: 'Condition', icon: GitBranch },
      { type: 'math', label: 'Math', icon: Calculator },
      { type: 'delay', label: 'Delay', icon: Timer },
    ],
  },
  {
    category: 'Utility',
    items: [
      { type: 'apiRequest', label: 'API Request', icon: Globe },
      { type: 'note', label: 'Note', icon: StickyNote },
    ],
  },
];
