// api.js
// -----------------------------------------------------------------------------
// Thin client for the FlowForge backend. Two calls: validate (plain JSON) and
// execute (SSE stream read manually off the fetch body, since EventSource
// can't POST a body).
// -----------------------------------------------------------------------------

export const API_BASE = 'http://localhost:8001';

export async function validatePipeline(nodes, edges) {
  const res = await fetch(`${API_BASE}/pipelines/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes, edges }),
  });
  if (!res.ok) {
    throw new Error(`Validation failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function executePipeline(nodes, edges, inputs, onEvent) {
  const res = await fetch(`${API_BASE}/pipelines/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes, edges, inputs }),
  });
  if (!res.ok) {
    throw new Error(`Execution failed (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line; the last chunk in the buffer
    // may be an incomplete event, so keep it for the next read.
    const events = buffer.split('\n\n');
    buffer = events.pop();

    for (const event of events) {
      for (const line of event.split('\n')) {
        if (line.startsWith('data: ')) {
          onEvent(JSON.parse(line.slice('data: '.length)));
        }
      }
    }
  }
}
