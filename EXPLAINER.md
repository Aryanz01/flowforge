# FlowForge — Design Notes & Walkthrough

Working notes: what each piece does, why it's built that way, and the
questions worth being ready for. Read this next to the code, not instead of it.

---

## 1. The story arc (30-second version)

1. The VectorShift take-home asked for a pipeline *editor*: node abstraction,
   styling, text-node logic, and a backend that only counts nodes/edges and
   checks for cycles.
2. The DAG check is the tell: the only reason a pipeline must be acyclic is
   so it can be **executed** in dependency order. So FlowForge takes the same
   editor concepts and adds the missing half — an execution engine with live
   feedback.
3. Design goal everywhere: **the simplest thing that demonstrates the idea.**
   One scheduler loop, one function per node type, one event stream, one
   store. No queues, no workers, no database.

## 2. Execution engine (`backend/engine.py`) — the heart

### Why topological order?

A pipeline is a DAG; a node can't run before the nodes feeding it. Kahn's
algorithm gives a linear order where every edge points forward. It's the same
algorithm as the assessment's `is_dag` check — if the sort consumes every
node, there's no cycle; the order it produces is the run schedule. One
algorithm, two uses.

### The one rule that everything hangs on

> A node executes only when **every connected input edge** has a produced
> value. Otherwise it's *skipped*.

Trace why this single rule produces three behaviors:

- **Error propagation**: a node that throws produces no outputs → every node
  fed by it finds a missing value → skipped. No special "poisoned" state.
- **Branching**: the Condition executor writes its input value to *only one*
  of its two output handles (`true`/`false`). The untaken handle produces
  nothing → that branch's downstream skips. Branching without any
  control-flow machinery in the engine.
- **Partial graphs**: an unconnected/orphan node with no inputs just runs;
  a node dangling off a skipped one doesn't.

Values live in one dict keyed by `(node_id, output_handle)`; edges are just
lookups into it. That's the whole dataflow model.

### Why an async generator?

`run_pipeline` is `async def` + `yield` — it *is* the event stream. A tiny
wrapper generator in `main.py` formats each event as an SSE frame (and, as a
last-resort guard, emits a terminal `run_error` if the engine throws
unexpectedly); FastAPI's `StreamingResponse` streams that. No callbacks, no
message broker; the run loop and the progress reporting are the same code
path. Async matters because executors await real I/O (LLM/API calls, delays)
without blocking the server.

### Why SSE and not WebSockets?

The data flows one way (server → client) for the duration of one request.
SSE is exactly that: a long-lived HTTP response. WebSockets would add a
connection lifecycle, reconnect logic, and a second protocol for zero
benefit here. (If runs became long-lived background jobs, that trade-off
changes — that's the honest answer to "when would you switch?")

## 3. Executors (`backend/executors.py`)

A dict `EXECUTORS: type → async def run(data, inputs, ctx) → {handle: value}`.

- `data` = what the user typed into the node's fields (from the frontend).
- `inputs` = values that arrived on connected input handles.
- `ctx` = run-scoped stuff: the run's input values, the collected outputs,
  and the current node's id (which the input/output executors need).

Adding a node type to the *backend* is one function in this dict; the engine
never changes. This mirrors the frontend registry (one config per node) —
both sides have a single extension point, which is the point of the design.

Details worth knowing cold:

- **LLM**: mock mode by default (`[mock:<model>] <first 300 chars of prompt>`
  after a 0.4s sleep so timing looks real). With `ANTHROPIC_API_KEY` set *and*
  a non-mock model selected, an httpx POST to the Messages API. Errors (bad
  key, timeout) raise → `node_error` → downstream skips; the run itself
  survives.
- **Condition**: tries float comparison first, falls back to string
  comparison; `contains` is substring. Deliberately not `eval()` — arbitrary
  expression evaluation is a security hole and an explainability tarpit.
- **Delay**: capped at 5s so nobody hangs a demo. **API Request**: 10s
  timeout, response text truncated to 2000 chars.

## 4. Frontend state (`frontend/src/store.js`)

One zustand store, two halves:

- **Graph half**: `nodes`, `edges`, and the ReactFlow change handlers. Field
  edits go through `updateNodeField(nodeId, key, value)` — node data lives in
  the store, not in component state, so the graph you submit is always the
  graph you see. (This was the subtle bug in the assessment starter: local
  `useState` in node components meant typed values never reached the store.)
- **Run half**: `runStatus`, `nodeStates`, `finalOutputs` — every SSE event
  is applied by exactly one function, `applyEvent(evt)`, a reducer over the
  event types (`startRun`/`resetRun`/`setGraph` only reset this state). The
  server is the source of truth about execution; the client just projects
  events into state. There is no client-side guessing about what ran.

Why zustand over Redux/Context: ReactFlow v11 already uses zustand
internally; it's ~1KB, unopinionated, and a node component can subscribe to
just its own slice (`s => s.nodeStates[id]`) so a status event re-renders one
node, not the whole canvas.

## 5. The SSE client (`frontend/src/api.js`)

`fetch` + `res.body.getReader()`, accumulate a text buffer, split on the SSE
frame delimiter `\n\n`, JSON-parse lines starting with `data: `, call
`onEvent`. ~30 lines. Why not `EventSource`? It only does GET — we need to
POST the graph. Buffering matters: a chunk can contain half an event or
three events; the split-and-keep-remainder loop handles both.

## 6. Node UI (`frontend/src/nodes/`)

Same abstraction as the assessment (deliberately — it proved itself there):
a node is a **config object** `{title, icon, description, fields, inputs,
outputs}`; `BaseNode` renders any config; `createNode(config)` adapts it to
ReactFlow. The registry maps 9 configs → `nodeTypes` for the canvas +
`paletteGroups` for the sidebar. Adding a node = 1 config here + 1 executor
in Python.

New in FlowForge: `BaseNode` also subscribes to its own `nodeStates[id]` and
renders execution status (pulse ring / green + ms badge / red + error /
dimmed) and an output preview footer. The Text node keeps its two tricks:
auto-growing textarea, and `{{var}}` regex → dynamic left handles (with
`useUpdateNodeInternals` so ReactFlow re-measures and the new handles accept
edges immediately).

One real gotcha we hit: node types named `input`/`output` collide with
ReactFlow's *built-in* type class names (`.react-flow__node-input` ships a
default white box). Fixed with a CSS reset — see the comment at the bottom of
`nodes.css`. Good interview story: know your library's reserved names.

## 7. Things intentionally NOT built (and the honest why)

- **Persistence/DB** — export/import JSON covers the demo; a database adds
  nothing to the core idea.
- **Parallel execution of independent branches** — the topo walk is
  sequential. Correct first; `asyncio.gather` on ready-sets is the natural
  next step and a great "how would you scale it" answer.
- **Retry/queue/background jobs** — runs are request-scoped. Real products
  (VectorShift included) need durable runs; that's a different project.
- **Deep schema validation of imported JSON** — import checks only basic
  shape (nodes/edges arrays, node id + position, so ReactFlow won't crash),
  and the backend's pydantic models 422 malformed payloads; anything subtler
  fails visibly at run time, which is acceptable for a dev tool.
- **eval() in Condition** — see above; a small operator set is safer and
  clearer.

## 8. Likely interview questions

- *Walk me through what happens when I click Run.*
  Header gathers input-node values (dialog) → `startRun()` clears state →
  POST /pipelines/execute → backend topo-sorts, walks nodes, yields SSE
  events → `applyEvent` reducer updates `nodeStates` → each BaseNode
  re-renders its ring; `run_finished` fills the results panel.
- *How does branching work without if/else in the engine?* → the one rule
  (section 2). Condition emits on one handle; missing values skip downstream.
- *Why does a node error not abort the run?* → sibling branches are
  independent; only the dependent subgraph is invalidated, and skipping it is
  free under the same rule.
- *What breaks with 10,000 nodes?* → the sort is fine at this scale (Kahn's
  is O(V+E), though this implementation's `list.pop(0)` makes it worst-case
  quadratic — swap in a `deque` to make it strictly linear); the sequential
  walk and the per-event React renders become the bottlenecks → batch events,
  virtualize the canvas, parallelize ready nodes.
- *Why is the node system config-driven?* → 9 node types differ only in
  data; components would be 9× the code with drift. Configs make the
  differences declarative and the rendering uniform. Same reasoning as the
  assessment, now proven twice.
