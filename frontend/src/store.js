// store.js
// -----------------------------------------------------------------------------
// Single zustand store for FlowForge: the graph the user is editing (nodes,
// edges, id counters) plus the live state of the current run (per-node status
// fed by SSE events). Shape is pinned by CONTRACTS.md — other modules read
// these exact field/action names.
// -----------------------------------------------------------------------------

import { create } from 'zustand';
import { addEdge, applyNodeChanges, applyEdgeChanges, MarkerType } from 'reactflow';
import { extractVariables } from './variables';

const emptyRunState = {
  runStatus: 'idle', // 'idle' | 'running' | 'done' | 'error'
  nodeStates: {},    // { [nodeId]: {status, ms?, output?, error?, reason?} }
  finalOutputs: null,
  runMs: null,
  runError: null,
};

export const useStore = create((set, get) => ({
  // ---- graph state ----------------------------------------------------------
  nodes: [],
  edges: [],
  nodeIDs: {}, // per-type counters, e.g. { input: 2 } → next input is 'input-3'

  getNodeID: (type) => {
    const nodeIDs = { ...get().nodeIDs };
    nodeIDs[type] = (nodeIDs[type] || 0) + 1;
    set({ nodeIDs });
    return `${type}-${nodeIDs[type]}`;
  },

  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
  },

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    set({
      edges: addEdge(
        {
          ...connection,
          type: 'smoothstep',
          animated: true,
          markerEnd: { type: MarkerType.Arrow, height: 20, width: 20 },
        },
        get().edges
      ),
    });
  },

  updateNodeField: (nodeId, key, value) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, [key]: value } } : node
      ),
    });
  },

  // Editing a Text node's template can remove {{variables}} — and with them
  // their handles. Edges into vanished handles would linger invisibly in the
  // store (exported, submitted, undeletable), so the Text node calls this when
  // editing FINISHES (on blur). Pruning per keystroke would sever edges during
  // transient states — e.g. select-all-and-retype passes through empty text.
  pruneStaleVarEdges: (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (node?.type !== 'text') return;
    const live = new Set(
      extractVariables(node.data?.text ?? '').map((name) => `${nodeId}-var-${name}`)
    );
    set({
      edges: get().edges.filter(
        (edge) =>
          edge.target !== nodeId ||
          !edge.targetHandle?.startsWith(`${nodeId}-var-`) ||
          live.has(edge.targetHandle)
      ),
    });
  },

  setGraph: ({ nodes, edges }) => {
    // Re-seed the per-type id counters from the incoming ids so that nodes
    // dropped after a demo/import don't collide with existing ids.
    const nodeIDs = {};
    for (const node of nodes) {
      const match = node.id.match(/^(.+)-(\d+)$/);
      if (match) {
        nodeIDs[match[1]] = Math.max(nodeIDs[match[1]] || 0, Number(match[2]));
      }
    }
    // Clear run state too: nodeStates from a previous run would otherwise
    // paint stale status rings onto the freshly loaded graph.
    set({ nodes, edges, nodeIDs, ...emptyRunState });
  },

  // ---- run state ------------------------------------------------------------
  ...emptyRunState,

  startRun: () => {
    set({ ...emptyRunState, runStatus: 'running' });
  },

  // Reducer for every SSE event type emitted by POST /pipelines/execute.
  applyEvent: (evt) => {
    switch (evt.type) {
      case 'run_started': {
        // Seed every node in the execution order as pending so the UI knows
        // which nodes the run will touch.
        const nodeStates = {};
        for (const id of evt.order) {
          nodeStates[id] = { status: 'pending' };
        }
        set({ nodeStates });
        break;
      }
      case 'node_started':
        set({ nodeStates: { ...get().nodeStates, [evt.nodeId]: { status: 'running' } } });
        break;
      case 'node_finished':
        set({
          nodeStates: {
            ...get().nodeStates,
            [evt.nodeId]: { status: 'done', ms: evt.ms, output: evt.output },
          },
        });
        break;
      case 'node_skipped':
        set({
          nodeStates: {
            ...get().nodeStates,
            [evt.nodeId]: { status: 'skipped', reason: evt.reason },
          },
        });
        break;
      case 'node_error':
        set({
          nodeStates: {
            ...get().nodeStates,
            [evt.nodeId]: { status: 'error', error: evt.error },
          },
        });
        break;
      case 'run_finished':
        set({ runStatus: 'done', finalOutputs: evt.outputs, runMs: evt.ms });
        break;
      case 'run_error': {
        // The run is over: nodes still pending/running will never get their
        // terminal event, so downgrade them or they pulse forever.
        const nodeStates = {};
        for (const [id, state] of Object.entries(get().nodeStates)) {
          nodeStates[id] =
            state.status === 'running' || state.status === 'pending'
              ? { status: 'skipped', reason: 'run aborted' }
              : state;
        }
        set({ runStatus: 'error', runError: evt.error, nodeStates });
        break;
      }
      default:
        break; // unknown event types are ignored on purpose
    }
  },

  resetRun: () => {
    set({ ...emptyRunState });
  },
}));
