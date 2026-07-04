// App.jsx
// -----------------------------------------------------------------------------
// App shell: Header on top, then a flex row of Palette (left) and the
// ReactFlow canvas (flex 1). ResultsPanel floats above the canvas. The Run
// flow (RunDialog included) is owned by Header — App only composes.
// -----------------------------------------------------------------------------

import { useState, useRef, useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import { shallow } from 'zustand/shallow';

import { useStore } from './store';
import { nodeTypes } from './nodes/registry.jsx';
import { Header } from './components/Header.jsx';
import { Palette } from './components/Palette.jsx';
import { ResultsPanel } from './components/ResultsPanel.jsx';

const gridSize = 20;
const proOptions = { hideAttribution: true };

const selector = (state) => ({
  nodes: state.nodes,
  edges: state.edges,
  getNodeID: state.getNodeID,
  addNode: state.addNode,
  onNodesChange: state.onNodesChange,
  onEdgesChange: state.onEdgesChange,
  onConnect: state.onConnect,
});

export default function App() {
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const { nodes, edges, getNodeID, addNode, onNodesChange, onEdgesChange, onConnect } =
    useStore(selector, shallow);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const payload = event.dataTransfer.getData('application/reactflow');
      if (!payload || !reactFlowInstance) return;

      const type = JSON.parse(payload)?.nodeType;
      if (!type) return;

      // Convert the drop's screen coordinates into canvas (flow) coordinates.
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const nodeID = getNodeID(type);
      // Field defaults are seeded into data by BaseNode on first render.
      addNode({ id: nodeID, type, position, data: {} });
    },
    [reactFlowInstance, getNodeID, addNode]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    // Inline flex skeleton keeps the layout correct independent of theme.css.
    <div className="ff-app" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <div className="ff-main" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Palette />
        <div ref={reactFlowWrapper} className="ff-canvas" style={{ flex: 1, height: '100%' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onInit={setReactFlowInstance}
            nodeTypes={nodeTypes}
            proOptions={proOptions}
            snapGrid={[gridSize, gridSize]}
            connectionLineType="smoothstep"
          >
            <Background color="#2a2f47" gap={gridSize} />
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={() => '#7c7ff2'}
              maskColor="rgba(13, 15, 26, 0.7)"
              style={{ background: '#161927' }}
            />
          </ReactFlow>
        </div>
      </div>
      <ResultsPanel />
    </div>
  );
}
