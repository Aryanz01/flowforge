# FlowForge — Module Contracts

Shared interfaces for all modules. Every module MUST conform exactly — these
names cross file boundaries. Keep implementations simple and explainable; no
cleverness, no extra dependencies, plain JavaScript (no TypeScript).

## Product

FlowForge is a visual AI pipeline builder: drag nodes onto a canvas, connect
them, click Run — the backend executes the graph in dependency order and
streams per-node status back to the canvas live. Think "mini VectorShift with
a working execution engine."

## Ports & endpoints

- Backend: FastAPI on **http://localhost:8001**. CORS allowed for
  `http://localhost:5173`.
- `GET /` → `{"status": "ok"}`
- `POST /pipelines/validate` body `{nodes, edges}` →
  `{"num_nodes": int, "num_edges": int, "is_dag": bool}`
- `POST /pipelines/execute` body `{nodes, edges, inputs}` where `inputs` is
  `{ [inputNodeId]: string }` → **SSE stream** (`text/event-stream`), each
  event a line `data: <json>\n\n`.

## Execution event protocol (SSE payloads)

```json
{"type": "run_started", "order": ["node-ids-in-topo-order"]}
{"type": "node_started", "nodeId": "llm-1"}
{"type": "node_finished", "nodeId": "llm-1", "output": {"response": "preview ≤200 chars"}, "ms": 412}
{"type": "node_skipped", "nodeId": "output-2", "reason": "upstream value unavailable"}
{"type": "node_error", "nodeId": "api-1", "error": "message"}
{"type": "run_finished", "outputs": {"output_1": "final value"}, "ms": 1240}
{"type": "run_error", "error": "Pipeline contains a cycle"}
```

Rules: `run_error` for whole-run failures (cycle) — then stop. Otherwise the
stream always ends with `run_finished`. A node error does NOT stop the run;
downstream nodes of a failed/skipped node are skipped.

## Graph payload shape (ReactFlow v11 native)

- node: `{id, type, position, data}` — pass through whatever ReactFlow holds.
- edge: `{id, source, sourceHandle, target, targetHandle, ...}`.
- Handle ids in ReactFlow are `${nodeId}-${handle}` — backend recovers the
  logical handle with `handleId.removeprefix(nodeId + "-")`.

## Node types (single source of truth)

| type       | data fields                              | inputs (logical)     | outputs        |
|------------|------------------------------------------|----------------------|----------------|
| input      | inputName, defaultValue                   | —                    | value          |
| output     | outputName                                | value                | —              |
| text       | text                                      | `var-<name>` dynamic | output         |
| llm        | model ('mock','claude-haiku-4-5','claude-sonnet-4-6') | system, prompt | response |
| apiRequest | method (GET/POST), url                    | body                 | response       |
| condition  | operator (==,!=,>,<,>=,<=,contains), compareTo | value           | true, false    |
| math       | operation (Add/Subtract/Multiply/Divide)  | a, b                 | result         |
| delay      | duration (ms, string)                     | in                   | out            |
| note       | note                                      | —                    | —              |

Text node dynamic inputs: `{{ name }}` patterns (valid JS identifiers) in
`data.text`, regex `/\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}/g`, deduped,
handle id `var-<name>`.

## Execution semantics (backend)

1. Kahn topological sort. Cycle → `run_error`.
2. Walk nodes in topo order. `note` is ignored entirely.
3. A node runs only when EVERY connected input edge has a produced value;
   otherwise `node_skipped`. (This is how condition branching works: the
   condition executor emits its input value on ONLY the `true` or `false`
   output handle, so the untaken branch's downstream nodes skip naturally.)
4. Executors are `async def run(data, inputs, ctx) -> dict[handle, value]`.
   `inputs` maps logical input handle → value. Missing optional inputs (e.g.
   unconnected LLM `system`) default to `""`.
5. `input` node: value = `ctx.run_inputs.get(nodeId) or data.defaultValue or ""`.
6. `output` node: records `ctx.outputs[data.outputName or nodeId] = inputs.get("value", "")`.
7. `llm`: if `ANTHROPIC_API_KEY` env set and model != 'mock' → call Anthropic
   Messages API via httpx (map claude-haiku-4-5 → `claude-haiku-4-5-20251001`,
   claude-sonnet-4-6 → `claude-sonnet-4-6`, max_tokens 512, 30s timeout);
   else return `f"[mock:{model}] {prompt[:300]}"` after a 0.4s sleep (so the
   demo shows realistic node timing).
8. `delay`: sleep min(duration, 5000) ms, pass `in` → `out`.
9. `apiRequest`: httpx request, 10s timeout, response text truncated to 2000
   chars. `condition` numeric compare when both sides parse as float, else
   string compare. `math` divide-by-zero → raise (becomes node_error).
10. Output previews in events truncated to 200 chars.

## Frontend store (zustand) — `frontend/src/store.js`

```js
export const useStore = create((set, get) => ({
  nodes: [], edges: [], nodeIDs: {},
  getNodeID(type),            // returns `${type}-${n}`
  addNode(node), onNodesChange(changes), onEdgesChange(changes), onConnect(connection),
  updateNodeField(nodeId, key, value),   // writes into node.data
  setGraph({nodes, edges}),              // replace whole graph (demo/import)
  // run state
  runStatus: 'idle',                     // 'idle' | 'running' | 'done' | 'error'
  nodeStates: {},                        // { [nodeId]: {status, ms?, output?, error?, reason?} }
  finalOutputs: null, runMs: null, runError: null,
  startRun(),                            // sets runStatus 'running', clears nodeStates
  applyEvent(evt),                       // reducer for every SSE event type above
  resetRun(),
}))
```

Edges created by `onConnect` use `{type:'smoothstep', animated:true}` plus an
arrow `markerEnd`.

## Frontend api — `frontend/src/api.js`

```js
export const API_BASE = 'http://localhost:8001';
export async function validatePipeline(nodes, edges)            // → parsed json
export async function executePipeline(nodes, edges, inputs, onEvent)
// fetch POST, read res.body stream, split on '\n\n', parse 'data: ' lines,
// call onEvent(parsedJson) for each. Throws on network/HTTP failure.
```

## Node UI — `frontend/src/nodes/`

Config-driven node system: a node type is a plain config object, not a
component. `BaseNode.jsx` renders from a config `{title, icon, description,
fields, inputs, outputs, width?, body?}`; `createNode(config)` factory;
`registry.jsx` exports `nodeTypes` (ReactFlow map) and `paletteGroups`
(`[{category, items: [{type, label, icon}]}]`). `TextNode.jsx` has the
auto-resize textarea + dynamic `{{var}}` handles.

New in FlowForge: BaseNode also subscribes to `nodeStates[id]` and shows
execution status — `running` (accent pulse ring), `done` (green ring + ms
badge), `error` (red ring + message), `skipped` (dimmed) — and after a run a
small footer with the truncated output preview. Class names: prefix `ff-`.
All node CSS lives in `frontend/src/nodes/nodes.css` (owned by the nodes module).

## Components — `frontend/src/components/`

- `Header.jsx` — logo/title; buttons: Load Demo, Export (download JSON),
  Import (file input), Validate (calls validatePipeline, small inline result
  pill), Run (primary; disabled while running).
- `Palette.jsx` — LEFT SIDEBAR (vertical), grouped draggable node chips
  (HTML5 drag with `application/reactflow` payload `{nodeType}`, read by the
  canvas onDrop handler).
- `RunDialog.jsx` — modal listing every `input` node (label = data.inputName)
  with a text field each (prefilled with defaultValue); Run/Cancel. If the
  graph has no input nodes the caller skips the dialog.
- `ResultsPanel.jsx` — bottom-right floating card after/during run: run
  status line, final outputs list, total ms, close button.
- Component CSS in `frontend/src/theme.css` (owned by components module)
  along with the design tokens below.

## Design tokens (theme.css `:root`, dark theme)

```
--bg: #0d0f1a;        --surface: #161927;   --surface-2: #1d2133;
--border: #262b40;    --border-strong: #323852;
--text: #e8eaf6;      --muted: #8b91ad;     --faint: #5c6180;
--accent: #7c7ff2;    --accent-2: #9f6ef2;  --accent-soft: rgba(124,127,242,.14);
--success: #34d399;   --warning: #fbbf24;   --danger: #f87171;
--radius: 10px;       --radius-sm: 7px;
--font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif;
```

App layout (`App.jsx`): header top bar; below it a flex row = Palette (220px)
+ canvas (flex 1). ResultsPanel and RunDialog render above the canvas.
`main.jsx` imports `reactflow/dist/style.css`, `./theme.css`,
`./nodes/nodes.css`.

## Style rules (all modules)

- Plain JS + JSX, React 18 function components, hooks only.
- Dependencies are FIXED: react, react-dom, reactflow@11, zustand, lucide-react
  (frontend); fastapi, uvicorn, httpx, python-dotenv (backend). Add nothing.
- Comment the *why* on non-obvious lines; no comment noise.
- Small files, small functions. If something feels clever, simplify it.
