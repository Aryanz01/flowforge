"""FlowForge backend test suite.

Runs fully offline: the LLM node stays in mock mode (no ANTHROPIC_API_KEY),
and no test touches the network. Async engine code is driven with plain
asyncio.run() from synchronous tests, so no pytest plugins are needed.
"""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

import executors
from engine import Ctx, run_pipeline, topo_sort
from main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Small builders so tests read like pipeline diagrams, not JSON noise.
# ---------------------------------------------------------------------------

def node(node_id, node_type, **data):
    return {"id": node_id, "type": node_type, "data": data}


def edge(source, source_handle, target, target_handle):
    """Build an edge using ReactFlow's handle-id convention '<nodeId>-<handle>'."""
    return {
        "id": f"{source}->{target}",
        "source": source,
        "sourceHandle": f"{source}-{source_handle}",
        "target": target,
        "targetHandle": f"{target}-{target_handle}",
    }


def run(nodes, edges, inputs=None):
    """Drive the async run_pipeline generator to completion, return all events."""

    async def collect():
        return [event async for event in run_pipeline(nodes, edges, inputs or {})]

    return asyncio.run(collect())


def types_of(events):
    return [event["type"] for event in events]


# ---------------------------------------------------------------------------
# 1. topo_sort
# ---------------------------------------------------------------------------

def test_topo_sort_linear_chain_keeps_dependency_order():
    edges = [{"source": "a", "target": "b"}, {"source": "b", "target": "c"}]
    assert topo_sort(["a", "b", "c"], edges) == ["a", "b", "c"]


def test_topo_sort_cycle_returns_none():
    edges = [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}]
    assert topo_sort(["a", "b"], edges) is None


def test_topo_sort_includes_disconnected_nodes():
    # 'lonely' has no edges at all; it must still appear in the order.
    order = topo_sort(["a", "b", "lonely"], [{"source": "a", "target": "b"}])
    assert sorted(order) == ["a", "b", "lonely"]
    assert order.index("a") < order.index("b")


def test_topo_sort_self_loop_is_a_cycle():
    assert topo_sort(["a"], [{"source": "a", "target": "a"}]) is None


# ---------------------------------------------------------------------------
# 2. run_pipeline happy path: input -> text -> llm(mock) -> output
# ---------------------------------------------------------------------------

def test_happy_path_event_sequence_and_final_outputs():
    nodes = [
        node("input-1", "input", inputName="topic"),
        node("text-1", "text", text="Summarize: {{topic}}"),
        node("llm-1", "llm", model="mock"),
        node("output-1", "output", outputName="result"),
    ]
    edges = [
        edge("input-1", "value", "text-1", "var-topic"),
        edge("text-1", "output", "llm-1", "prompt"),
        edge("llm-1", "response", "output-1", "value"),
    ]
    events = run(nodes, edges, inputs={"input-1": "cats"})

    assert types_of(events) == [
        "run_started",
        "node_started", "node_finished",   # input-1
        "node_started", "node_finished",   # text-1
        "node_started", "node_finished",   # llm-1
        "node_started", "node_finished",   # output-1
        "run_finished",
    ]
    assert events[0]["order"] == ["input-1", "text-1", "llm-1", "output-1"]

    text_finished = events[4]
    assert text_finished["nodeId"] == "text-1"
    assert text_finished["output"] == {"output": "Summarize: cats"}

    assert events[-1]["outputs"] == {"result": "[mock:mock] Summarize: cats"}
    assert isinstance(events[-1]["ms"], int)


# ---------------------------------------------------------------------------
# 3. condition branching
# ---------------------------------------------------------------------------

def _condition_pipeline(compare_to):
    """input('10') -> condition('>' compare_to); each branch feeds its own output."""
    nodes = [
        node("input-1", "input", defaultValue="10"),
        node("cond-1", "condition", operator=">", compareTo=compare_to),
        node("out-true", "output", outputName="took_true"),
        node("out-false", "output", outputName="took_false"),
    ]
    edges = [
        edge("input-1", "value", "cond-1", "value"),
        edge("cond-1", "true", "out-true", "value"),
        edge("cond-1", "false", "out-false", "value"),
    ]
    return nodes, edges


def test_condition_true_branch_runs_and_false_branch_skips():
    events = run(*_condition_pipeline(compare_to="5"))  # 10 > 5 -> true

    skipped = [e for e in events if e["type"] == "node_skipped"]
    assert [e["nodeId"] for e in skipped] == ["out-false"]
    assert skipped[0]["reason"] == "upstream value unavailable"
    assert events[-1]["outputs"] == {"took_true": "10"}


def test_condition_false_branch_runs_and_true_branch_skips():
    events = run(*_condition_pipeline(compare_to="50"))  # 10 > 50 -> false

    skipped = [e for e in events if e["type"] == "node_skipped"]
    assert [e["nodeId"] for e in skipped] == ["out-true"]
    assert events[-1]["outputs"] == {"took_false": "10"}


# ---------------------------------------------------------------------------
# 4. node_error isolation: divide by zero
# ---------------------------------------------------------------------------

def test_divide_by_zero_errors_node_skips_downstream_and_run_still_finishes():
    nodes = [
        node("input-1", "input", defaultValue="1"),
        node("math-1", "math", operation="Divide"),  # b unconnected -> 0 -> 1/0
        node("output-1", "output", outputName="result"),
    ]
    edges = [
        edge("input-1", "value", "math-1", "a"),
        edge("math-1", "result", "output-1", "value"),
    ]
    events = run(nodes, edges)

    errors = [e for e in events if e["type"] == "node_error"]
    assert [e["nodeId"] for e in errors] == ["math-1"]
    assert errors[0]["error"]  # a human-readable message, not empty

    skipped = [e for e in events if e["type"] == "node_skipped"]
    assert [e["nodeId"] for e in skipped] == ["output-1"]

    assert events[-1]["type"] == "run_finished"
    assert events[-1]["outputs"] == {}


# ---------------------------------------------------------------------------
# 5. NaN sanitization
# ---------------------------------------------------------------------------

def test_nan_result_is_stringified_so_events_stay_valid_json():
    # inf * 0 = nan. The engine must stringify it in run_finished, because
    # NaN is a valid Python float but invalid JSON.
    nodes = [
        node("input-1", "input", defaultValue="inf"),
        node("math-1", "math", operation="Multiply"),  # b unconnected -> 0
        node("output-1", "output", outputName="nan_result"),
    ]
    edges = [
        edge("input-1", "value", "math-1", "a"),
        edge("math-1", "result", "output-1", "value"),
    ]
    events = run(nodes, edges)

    assert events[-1]["type"] == "run_finished"
    assert events[-1]["outputs"] == {"nan_result": "nan"}
    for event in events:  # every event must survive strict JSON encoding
        json.dumps(event, allow_nan=False)


# ---------------------------------------------------------------------------
# 6. note nodes are ignored entirely
# ---------------------------------------------------------------------------

def test_note_nodes_produce_no_events_and_are_absent_from_order():
    nodes = [
        node("input-1", "input", defaultValue="hi"),
        node("note-1", "note", note="just a comment on the canvas"),
        node("output-1", "output", outputName="result"),
    ]
    edges = [edge("input-1", "value", "output-1", "value")]
    events = run(nodes, edges)

    assert events[0]["order"] == ["input-1", "output-1"]  # note-1 not scheduled
    assert all(event.get("nodeId") != "note-1" for event in events)
    assert events[-1]["outputs"] == {"result": "hi"}


# ---------------------------------------------------------------------------
# 7. unknown node type
# ---------------------------------------------------------------------------

def test_unknown_node_type_emits_node_error_and_run_finishes():
    events = run([node("mystery-1", "banana")], [])

    assert types_of(events) == ["run_started", "node_error", "run_finished"]
    assert events[1]["nodeId"] == "mystery-1"
    assert "banana" in events[1]["error"]


# ---------------------------------------------------------------------------
# 8. text node with an unconnected {{var}} handle
# ---------------------------------------------------------------------------

def test_text_unconnected_var_interpolates_as_empty_string():
    # Contract (executors.run_text): a {{var}} with no connected edge simply
    # interpolates as '' — the node still runs with whatever IS connected.
    nodes = [
        node("input-1", "input", defaultValue="cats"),
        node("text-1", "text", text="Hi {{who}}, welcome to {{place}}"),
        node("output-1", "output", outputName="greeting"),
    ]
    edges = [
        edge("input-1", "value", "text-1", "var-who"),  # var-place left unconnected
        edge("text-1", "output", "output-1", "value"),
    ]
    events = run(nodes, edges)

    assert types_of(events).count("node_skipped") == 0  # text-1 still ran
    assert events[-1]["outputs"] == {"greeting": "Hi cats, welcome to "}


# ---------------------------------------------------------------------------
# 9. delay: passthrough + the 5 s sleep cap
# ---------------------------------------------------------------------------

def test_delay_passes_input_through_unchanged():
    nodes = [
        node("input-1", "input", defaultValue="ping"),
        node("delay-1", "delay", duration="50"),
        node("output-1", "output", outputName="result"),
    ]
    edges = [
        edge("input-1", "value", "delay-1", "in"),
        edge("delay-1", "out", "output-1", "value"),
    ]
    events = run(nodes, edges)
    assert events[-1]["outputs"] == {"result": "ping"}


def test_delay_clamps_requested_sleep_to_five_seconds(monkeypatch):
    # Call the executor directly with asyncio.sleep replaced by a recorder,
    # so we can prove duration '99999' ms is clamped to 5.0 s without sleeping.
    recorded = []

    async def fake_sleep(seconds):
        recorded.append(seconds)

    monkeypatch.setattr("executors.asyncio.sleep", fake_sleep)
    result = asyncio.run(executors.run_delay({"duration": "99999"}, {"in": "x"}, Ctx({})))

    assert recorded == [5.0]  # min(99999, 5000) / 1000
    assert result == {"out": "x"}


# ---------------------------------------------------------------------------
# 10. HTTP layer (FastAPI TestClient — no real server, no network)
# ---------------------------------------------------------------------------

def test_validate_endpoint_counts_nodes_edges_and_detects_dag():
    payload = {
        "nodes": [node("input-1", "input"), node("output-1", "output")],
        "edges": [edge("input-1", "value", "output-1", "value")],
    }
    res = client.post("/pipelines/validate", json=payload)

    assert res.status_code == 200
    assert res.json() == {"num_nodes": 2, "num_edges": 1, "is_dag": True}


def test_validate_rejects_node_missing_id_with_422():
    payload = {"nodes": [{"type": "input", "data": {}}], "edges": []}
    assert client.post("/pipelines/validate", json=payload).status_code == 422


def test_execute_rejects_edge_missing_source_with_422():
    payload = {
        "nodes": [node("output-1", "output")],
        "edges": [{"id": "bad", "target": "output-1"}],  # no 'source'
        "inputs": {},
    }
    assert client.post("/pipelines/execute", json=payload).status_code == 422


def test_execute_streams_sse_events_ending_with_run_finished():
    payload = {
        "nodes": [node("input-1", "input"), node("output-1", "output", outputName="result")],
        "edges": [edge("input-1", "value", "output-1", "value")],
        "inputs": {"input-1": "hello"},
    }
    res = client.post("/pipelines/execute", json=payload)

    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")

    frames = [f for f in res.text.split("\n\n") if f]
    assert all(f.startswith("data: ") for f in frames)
    events = [json.loads(f.removeprefix("data: ")) for f in frames]

    assert types_of(events)[0] == "run_started"
    assert events[-1]["type"] == "run_finished"
    assert events[-1]["outputs"] == {"result": "hello"}


# ---------------------------------------------------------------------------
# 11. LLM mock mode
# ---------------------------------------------------------------------------

def test_llm_returns_mock_response_when_no_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    result = asyncio.run(executors.run_llm({"model": "mock"}, {"prompt": "hello"}, Ctx({})))
    assert result["response"].startswith("[mock:")
    assert "hello" in result["response"]

    # Even a real model name must fall back to mock when the key is absent.
    result = asyncio.run(
        executors.run_llm({"model": "claude-haiku-4-5"}, {"prompt": "hi"}, Ctx({}))
    )
    assert result["response"].startswith("[mock:claude-haiku-4-5]")
