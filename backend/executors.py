"""Per-node-type executors: async def run(data, inputs, ctx) -> dict[handle, value]."""

import asyncio
import os
import re

import httpx

# Matches {{ name }} where name is a valid JS identifier (same regex as the frontend).
VAR_RE = re.compile(r"\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}")

# UI model choice -> Anthropic API model id.
MODEL_IDS = {
    "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
}


async def run_input(data, inputs, ctx):
    value = ctx.run_inputs.get(ctx.node_id) or data.get("defaultValue") or ""
    return {"value": value}


async def run_output(data, inputs, ctx):
    ctx.outputs[data.get("outputName") or ctx.node_id] = inputs.get("value", "")
    return {}


async def run_text(data, inputs, ctx):
    text = data.get("text") or ""

    def replace(match):
        # Interpolated values arrive on 'var-<name>' handles; missing -> ''.
        return str(inputs.get("var-" + match.group(1), ""))

    return {"output": VAR_RE.sub(replace, text)}


async def run_llm(data, inputs, ctx):
    model = data.get("model") or "mock"
    prompt = str(inputs.get("prompt", ""))
    system = str(inputs.get("system", ""))
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if not api_key or model == "mock":
        await asyncio.sleep(0.4)  # simulate latency so the demo shows realistic timing
        return {"response": f"[mock:{model}] {prompt[:300]}"}

    body = {
        "model": MODEL_IDS.get(model, model),
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        body["system"] = system
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
        res.raise_for_status()
        blocks = res.json().get("content", [])
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        return {"response": text}


async def run_api_request(data, inputs, ctx):
    method = (data.get("method") or "GET").upper()
    url = data.get("url") or ""
    body = inputs.get("body")
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        res = await client.request(
            method, url, content=str(body) if body is not None else None
        )
        return {"response": res.text[:2000]}


OPS = {
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
}


async def run_condition(data, inputs, ctx):
    value = inputs.get("value", "")
    compare_to = data.get("compareTo", "")
    operator = data.get("operator") or "=="

    if operator == "contains":
        result = str(compare_to) in str(value)
    else:
        # Numeric compare when both sides parse as floats, else string compare.
        try:
            a, b = float(value), float(compare_to)
        except (TypeError, ValueError):
            a, b = str(value), str(compare_to)
        result = OPS[operator](a, b)

    # Emit the input value on ONLY the taken branch; the untaken branch's
    # downstream nodes then skip naturally in the run loop.
    return {"true": value} if result else {"false": value}


async def run_math(data, inputs, ctx):
    a = float(inputs.get("a", 0))
    b = float(inputs.get("b", 0))
    operation = data.get("operation") or "Add"
    if operation == "Add":
        return {"result": a + b}
    if operation == "Subtract":
        return {"result": a - b}
    if operation == "Multiply":
        return {"result": a * b}
    return {"result": a / b}  # divide by zero raises -> node_error


async def run_delay(data, inputs, ctx):
    try:
        duration = float(data.get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0
    await asyncio.sleep(min(duration, 5000) / 1000)
    return {"out": inputs.get("in", "")}


EXECUTORS = {
    "input": run_input,
    "output": run_output,
    "text": run_text,
    "llm": run_llm,
    "apiRequest": run_api_request,
    "condition": run_condition,
    "math": run_math,
    "delay": run_delay,
}
