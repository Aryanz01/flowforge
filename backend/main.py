"""FlowForge backend: validate and execute pipelines, streaming results as SSE."""

import json

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from engine import run_pipeline, topo_sort

load_dotenv()  # loads ANTHROPIC_API_KEY if present; mock LLM mode works without it

app = FastAPI(title="FlowForge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Minimal payload models: enough shape-checking that malformed imports get a
# clean 422 instead of a 500 (or a mid-stream crash), while extra ReactFlow
# fields (position, markerEnd, ...) pass through untouched.
class Node(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    type: str = ""
    data: dict = Field(default_factory=dict)


class Edge(BaseModel):
    model_config = ConfigDict(extra="allow")
    source: str
    target: str
    sourceHandle: str | None = None
    targetHandle: str | None = None


class Pipeline(BaseModel):
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)


class ExecuteBody(Pipeline):
    inputs: dict[str, str] = Field(default_factory=dict)


@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/pipelines/validate")
def validate(payload: Pipeline):
    node_ids = [n.id for n in payload.nodes]
    edges = [e.model_dump() for e in payload.edges]
    return {
        "num_nodes": len(payload.nodes),
        "num_edges": len(payload.edges),
        "is_dag": topo_sort(node_ids, edges) is not None,
    }


@app.post("/pipelines/execute")
async def execute(payload: ExecuteBody):
    nodes = [n.model_dump() for n in payload.nodes]
    edges = [e.model_dump() for e in payload.edges]

    async def stream():
        # Last-resort guard: the protocol promises every stream ends with a
        # terminal event, even if the engine hits an unexpected exception.
        try:
            async for event in run_pipeline(nodes, edges, payload.inputs):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as exc:
            error = {"type": "run_error", "error": str(exc) or type(exc).__name__}
            yield f"data: {json.dumps(error)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
