// Header.jsx — top bar: brand + pipeline actions (Load Demo, Export, Import,
// Validate, Run). Owns the RunDialog open/close state and the run kickoff.

import { useMemo, useRef, useState } from 'react';
import { Workflow, Sparkles, Download, Upload, FlaskConical, Play } from 'lucide-react';
import { useStore } from '../store';
import { validatePipeline, executePipeline } from '../api';
import { demoPipeline } from '../demo.js';
import { RunDialog } from './RunDialog';

// A file is only importable if it actually looks like a pipeline: ReactFlow
// crashes on nodes without a position, so check shape before committing.
const isValidGraph = (graph) =>
  Array.isArray(graph?.nodes) &&
  Array.isArray(graph?.edges) &&
  graph.nodes.every(
    (node) =>
      typeof node?.id === 'string' &&
      typeof node?.position?.x === 'number' &&
      typeof node?.position?.y === 'number'
  ) &&
  // Non-object edge entries (e.g. null) crash ReactFlow's edge grouping, so
  // require the minimal edge shape too.
  graph.edges.every(
    (edge) => typeof edge?.source === 'string' && typeof edge?.target === 'string'
  );

export function Header() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const runStatus = useStore((s) => s.runStatus);
  const setGraph = useStore((s) => s.setGraph);
  const startRun = useStore((s) => s.startRun);
  const applyEvent = useStore((s) => s.applyEvent);

  const [pill, setPill] = useState(null); // { text, ok } — transient validate result
  const [dialogOpen, setDialogOpen] = useState(false);
  const fileRef = useRef(null);
  const pillTimer = useRef(null);

  // Memoized: RunDialog re-seeds its form when this array changes identity,
  // so a fresh filter() on every render would wipe values the user is typing.
  const inputNodes = useMemo(() => nodes.filter((n) => n.type === 'input'), [nodes]);

  const showPill = (text, ok) => {
    setPill({ text, ok });
    // Reset the timer so rapid clicks don't hide a fresh pill early.
    clearTimeout(pillTimer.current);
    pillTimer.current = setTimeout(() => setPill(null), 4000);
  };

  const handleValidate = async () => {
    try {
      const res = await validatePipeline(nodes, edges);
      showPill(
        `${res.num_nodes} nodes · ${res.num_edges} edges · DAG ${res.is_dag ? '✓' : '✗'}`,
        res.is_dag
      );
    } catch {
      showPill('Could not reach backend on http://localhost:8001', false);
    }
  };

  const handleExport = () => {
    const json = JSON.stringify({ nodes, edges }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flowforge-pipeline.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const graph = JSON.parse(reader.result);
        if (!isValidGraph(graph)) {
          showPill('Import failed: not a FlowForge pipeline file', false);
          return;
        }
        setGraph({ nodes: graph.nodes, edges: graph.edges });
        showPill('Pipeline imported', true);
      } catch {
        showPill('Import failed: file is not valid JSON', false);
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // allow re-importing the same file
  };

  const beginRun = async (inputs) => {
    setDialogOpen(false);
    startRun();
    try {
      await executePipeline(nodes, edges, inputs, applyEvent);
      // The protocol says every stream ends with run_finished/run_error; if
      // the connection dropped mid-run, don't leave the UI stuck on 'running'.
      if (useStore.getState().runStatus === 'running') {
        applyEvent({ type: 'run_error', error: 'Stream ended without a result' });
      }
    } catch (err) {
      console.error(err);
      const error =
        err instanceof TypeError // fetch network failure, not an HTTP/parse error
          ? 'Could not reach backend on http://localhost:8001'
          : err.message || 'Run failed';
      applyEvent({ type: 'run_error', error });
    }
  };

  const handleRunClick = () => {
    // Input nodes need values from the user first; otherwise run right away.
    if (inputNodes.length > 0) setDialogOpen(true);
    else beginRun({});
  };

  return (
    <header className="ff-header">
      <div className="ff-header__brand">
        <div className="ff-header__logo">
          <Workflow size={19} strokeWidth={2.2} />
        </div>
        <div>
          <h1 className="ff-header__title">FlowForge</h1>
          <p className="ff-header__subtitle">Visual AI pipeline builder</p>
        </div>
      </div>

      <div className="ff-header__actions">
        {pill && (
          <span className={`ff-pill ${pill.ok ? 'ff-pill--ok' : 'ff-pill--bad'}`}>
            {pill.text}
          </span>
        )}
        <button className="ff-btn" onClick={() => setGraph(demoPipeline)}>
          <Sparkles size={14} /> Load Demo
        </button>
        <button className="ff-btn" onClick={handleExport}>
          <Download size={14} /> Export
        </button>
        <button className="ff-btn" onClick={() => fileRef.current.click()}>
          <Upload size={14} /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <button className="ff-btn" onClick={handleValidate}>
          <FlaskConical size={14} /> Validate
        </button>
        <button
          className="ff-btn ff-btn--primary"
          onClick={handleRunClick}
          disabled={runStatus === 'running'}
        >
          <Play size={14} /> {runStatus === 'running' ? 'Running…' : 'Run'}
        </button>
      </div>

      <RunDialog
        open={dialogOpen}
        inputNodes={inputNodes}
        onCancel={() => setDialogOpen(false)}
        onRun={beginRun}
      />
    </header>
  );
}

