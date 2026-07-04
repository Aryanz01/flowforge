// demo.js
// -----------------------------------------------------------------------------
// Hand-authored showcase pipeline for the "Load Demo" button. Two flows:
//   1. name + topic inputs → text template → mock LLM → output "haiku"
//   2. threshold input → condition (> 5): true → output "above_five",
//      false → 1s delay → output "below_five"
// Laid out left-to-right in columns (x = 60/340/640/940/1240) with enough
// y-spread that nothing overlaps. Handle ids follow `${nodeId}-${handle}`.
// -----------------------------------------------------------------------------

const edgeStyle = {
  type: 'smoothstep',
  animated: true,
  markerEnd: { type: 'arrow', width: 20, height: 20 },
};

export const demoPipeline = {
  nodes: [
    // --- haiku flow ---
    {
      id: 'input-1',
      type: 'input',
      position: { x: 60, y: 40 },
      data: { inputName: 'name', defaultValue: 'Rohit' },
    },
    {
      id: 'input-2',
      type: 'input',
      position: { x: 60, y: 220 },
      data: { inputName: 'topic', defaultValue: 'the ocean' },
    },
    {
      id: 'text-1',
      type: 'text',
      position: { x: 340, y: 100 },
      data: { text: 'Write a haiku about {{topic}} for {{name}}' },
    },
    {
      id: 'llm-1',
      type: 'llm',
      position: { x: 640, y: 90 },
      data: { model: 'mock' },
    },
    {
      id: 'output-1',
      type: 'output',
      position: { x: 940, y: 110 },
      data: { outputName: 'haiku' },
    },

    // --- condition flow ---
    {
      id: 'input-3',
      type: 'input',
      position: { x: 60, y: 430 },
      data: { inputName: 'threshold', defaultValue: '7' },
    },
    {
      id: 'condition-1',
      type: 'condition',
      position: { x: 340, y: 420 },
      data: { operator: '>', compareTo: '5' },
    },
    {
      id: 'output-2',
      type: 'output',
      position: { x: 640, y: 400 },
      data: { outputName: 'above_five' },
    },
    {
      id: 'delay-1',
      type: 'delay',
      position: { x: 940, y: 540 },
      data: { duration: '1000' },
    },
    {
      id: 'output-3',
      type: 'output',
      position: { x: 1240, y: 540 },
      data: { outputName: 'below_five' },
    },
  ],

  edges: [
    {
      id: 'e-input-1-text-1',
      source: 'input-1',
      sourceHandle: 'input-1-value',
      target: 'text-1',
      targetHandle: 'text-1-var-name',
      ...edgeStyle,
    },
    {
      id: 'e-input-2-text-1',
      source: 'input-2',
      sourceHandle: 'input-2-value',
      target: 'text-1',
      targetHandle: 'text-1-var-topic',
      ...edgeStyle,
    },
    {
      id: 'e-text-1-llm-1',
      source: 'text-1',
      sourceHandle: 'text-1-output',
      target: 'llm-1',
      targetHandle: 'llm-1-prompt',
      ...edgeStyle,
    },
    {
      id: 'e-llm-1-output-1',
      source: 'llm-1',
      sourceHandle: 'llm-1-response',
      target: 'output-1',
      targetHandle: 'output-1-value',
      ...edgeStyle,
    },
    {
      id: 'e-input-3-condition-1',
      source: 'input-3',
      sourceHandle: 'input-3-value',
      target: 'condition-1',
      targetHandle: 'condition-1-value',
      ...edgeStyle,
    },
    {
      id: 'e-condition-1-output-2',
      source: 'condition-1',
      sourceHandle: 'condition-1-true',
      target: 'output-2',
      targetHandle: 'output-2-value',
      ...edgeStyle,
    },
    {
      id: 'e-condition-1-delay-1',
      source: 'condition-1',
      sourceHandle: 'condition-1-false',
      target: 'delay-1',
      targetHandle: 'delay-1-in',
      ...edgeStyle,
    },
    {
      id: 'e-delay-1-output-3',
      source: 'delay-1',
      sourceHandle: 'delay-1-out',
      target: 'output-3',
      targetHandle: 'output-3-value',
      ...edgeStyle,
    },
  ],
};
