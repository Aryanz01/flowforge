# FlowForge

A visual AI pipeline builder with a working execution engine. Drag nodes onto
a canvas, connect them into a workflow, click **Run** — the backend executes
the graph in dependency order and streams every node's status back to the
canvas live.

Built as a follow-up to the VectorShift frontend assessment: that project
ends at *validating* a pipeline (is it a DAG?); FlowForge answers the obvious
next question — *what does it take to actually run one?*

## Features

- **9 node types** — Input, Output, Text, LLM, Condition, Math, Delay,
  API Request, Note — all defined as small config objects over one `BaseNode`
- **Real execution** — topological scheduling, per-node executors, values
  flowing along edges
- **Live status streaming** — Server-Sent Events per node: running → pulse,
  done → green ring + duration, error → red + message, skipped → dimmed
- **Branching** — Condition nodes route a value down exactly one branch; the
  untaken branch's downstream nodes skip automatically
- **Text templating** — `{{ variables }}` in a Text node become input handles;
  values interpolate at run time
- **LLM node** — calls the Anthropic Messages API when `ANTHROPIC_API_KEY` is
  set *and* a non-mock model is selected; defaults to a keyless mock mode so
  the demo runs anywhere
- **Pipeline I/O** — export/import JSON, one-click demo pipeline

## Run it

Backend (Python 3.10+):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8001
```

Frontend (Node 18+):

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Optional: `cp backend/.env.example backend/.env`, add an `ANTHROPIC_API_KEY`,
and pick a non-mock model in the LLM node's dropdown to call a real model;
otherwise the node returns a mock response.

Then: **Load Demo → Run**.

## How it works

```
React canvas (reactflow + zustand)
        │  POST /pipelines/execute {nodes, edges, inputs}
        ▼
FastAPI ── topological sort ── walk nodes in order
        │     each node: gather input values from connected edges,
        │     run its executor, store outputs keyed by (node, handle)
        ▼
SSE stream: run_started → node_started/finished/skipped/error… → run_finished
        │
        ▼
zustand applyEvent() reducer → node components re-render their status live
```

Key invariant: a node runs only when **every connected input edge has a
produced value**. That single rule gives error propagation and condition
branching for free — a failed or skipped node produces nothing, so everything
downstream of it skips.

## Reliability & scaling

- Typed pydantic payload models: malformed graphs get a 422, not a mid-stream crash.
- Every execute stream ends with a terminal event — `run_finished`, or `run_error`
  even on unexpected engine exceptions; the client unsticks nodes if the stream dies.
- Errors are isolated per node: an executor exception becomes `node_error`; only
  its dependent subgraph skips, sibling branches finish.
- 19-test pytest suite over the engine, executors, and HTTP layer
  (`backend/test_engine.py` — run with `.venv/bin/python -m pytest`).
- Scaling path (EXPLAINER §7/§8): run ready sets in parallel via `asyncio.gather`,
  batch SSE events for large graphs, move long runs to durable background jobs.

## Repo map

```
backend/
  main.py         FastAPI app: /pipelines/validate, /pipelines/execute (SSE)
  engine.py       topo sort + the run loop (async generator of events)
  executors.py    one async function per node type
frontend/src/
  store.js        zustand store: graph state + run state (applyEvent reducer)
  api.js          fetch client + SSE stream parser
  App.jsx         canvas shell (drag-drop, ReactFlow wiring)
  demo.js         the showcase pipeline
  variables.js    {{ var }} regex + extractVariables (shared by Text node & store)
  main.jsx        React entry point (imports reactflow/theme/nodes CSS)
  theme.css       design tokens + component styles
  nodes/          BaseNode + createNode factory, registry of 9 configs, Text node, nodes.css
  components/     Header (run flow), Palette, RunDialog, ResultsPanel
CONTRACTS.md      the interface spec the modules were built against
```
