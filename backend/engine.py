"""Graph utilities and the pipeline run loop."""

import math
import time

from executors import EXECUTORS


def strip_handle(node_id, handle_id):
    """ReactFlow handle ids are '<nodeId>-<handle>'; recover the logical handle."""
    if not handle_id:
        return handle_id
    return handle_id.removeprefix(node_id + "-")


def topo_sort(node_ids, edges):
    """Kahn's algorithm. Returns node ids in dependency order, or None on a cycle."""
    indegree = {nid: 0 for nid in node_ids}
    children = {nid: [] for nid in node_ids}
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if source in indegree and target in indegree:
            indegree[target] += 1
            children[source].append(target)
    queue = [nid for nid, deg in indegree.items() if deg == 0]
    order = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for child in children[nid]:
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    # If some nodes never reached indegree 0, they sit on a cycle.
    return order if len(order) == len(node_ids) else None


class Ctx:
    """Run-level state shared with executors."""

    def __init__(self, run_inputs):
        self.run_inputs = run_inputs or {}
        self.outputs = {}
        self.node_id = None  # set by the run loop before each executor call


def _preview(outputs):
    return {handle: str(value)[:200] for handle, value in outputs.items()}


async def run_pipeline(nodes, edges, run_inputs):
    """Async generator yielding one event dict per protocol step."""
    nodes = [n for n in nodes if n.get("id") and n.get("type") != "note"]  # notes never execute
    by_id = {n["id"]: n for n in nodes}
    edges = [e for e in edges if e.get("source") in by_id and e.get("target") in by_id]

    order = topo_sort(list(by_id), edges)
    if order is None:
        yield {"type": "run_error", "error": "Pipeline contains a cycle"}
        return
    yield {"type": "run_started", "order": order}

    ctx = Ctx(run_inputs)
    produced = {}  # (source node id, logical output handle) -> value
    run_t0 = time.perf_counter()

    for node_id in order:
        node = by_id[node_id]

        # A node runs only when EVERY connected input edge has a produced value.
        # Skipped/errored upstream nodes and untaken condition branches produce
        # nothing, so their downstream nodes skip here naturally.
        inputs = {}
        ready = True
        for edge in edges:
            if edge.get("target") != node_id:
                continue
            key = (edge["source"], strip_handle(edge["source"], edge.get("sourceHandle")))
            if key not in produced:
                ready = False
                break
            inputs[strip_handle(node_id, edge.get("targetHandle"))] = produced[key]
        if not ready:
            yield {"type": "node_skipped", "nodeId": node_id, "reason": "upstream value unavailable"}
            continue

        executor = EXECUTORS.get(node.get("type"))
        if executor is None:
            yield {"type": "node_error", "nodeId": node_id, "error": f"Unknown node type: {node.get('type')}"}
            continue

        yield {"type": "node_started", "nodeId": node_id}
        ctx.node_id = node_id  # input/output executors need to know which node runs
        node_t0 = time.perf_counter()
        try:
            outputs = await executor(node.get("data") or {}, inputs, ctx)
        except Exception as exc:  # a node failure must not stop the run
            yield {"type": "node_error", "nodeId": node_id, "error": str(exc) or type(exc).__name__}
            continue
        ms = round((time.perf_counter() - node_t0) * 1000)

        for handle, value in outputs.items():
            produced[(node_id, handle)] = value
        yield {"type": "node_finished", "nodeId": node_id, "output": _preview(outputs), "ms": ms}

    total_ms = round((time.perf_counter() - run_t0) * 1000)
    # NaN/Infinity are valid Python floats but invalid JSON — json.dumps would
    # emit tokens the frontend's JSON.parse rejects. Stringify them instead.
    outputs = {
        name: str(value) if isinstance(value, float) and not math.isfinite(value) else value
        for name, value in ctx.outputs.items()
    }
    yield {"type": "run_finished", "outputs": outputs, "ms": total_ms}
