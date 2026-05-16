"use client";

// Phase 1A UI — intentionally unstyled. Plain HTML elements, no Tailwind,
// no animations. Goal: prove the kernel works end-to-end.
//
// Layout:
//   - Header
//   - Agent picker (select)
//   - Prompt textarea + send button
//   - Response area (streamed tokens append into a <pre>)
//   - Last-50 bus events (<ul>, newest first)

import { useEffect, useRef, useState } from "react";

interface Agent {
  name: string;
  displayName: string;
  description: string | null;
  transport: string;
  capabilities: { chat?: boolean; streamingChat?: boolean };
}

interface BusEvent {
  id: string;
  ts: number;
  source: string;
  kind: string;
  payload?: unknown;
}

export default function Page() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load agents list on mount.
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((j: { agents: Agent[] }) => {
        setAgents(j.agents);
        if (j.agents.length > 0 && !selected) {
          setSelected(j.agents[0]!.name);
        }
      })
      .catch((e) => setError(`failed to load agents: ${String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to bus events.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        const evt = JSON.parse(m.data) as BusEvent;
        setEvents((prev) => [evt, ...prev].slice(0, 50));
      } catch {
        /* keepalive comment lines don't fire onmessage; ignore parse errors */
      }
    };
    es.onerror = () => {
      // Browser will auto-reconnect.
    };
    return () => es.close();
  }, []);

  async function runPrompt() {
    if (!selected || !prompt.trim() || running) return;
    setRunning(true);
    setResponse("");
    setSavedPath(null);
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(selected)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        setError(`HTTP ${r.status}: ${await r.text()}`);
        return;
      }
      if (!r.body) {
        setError("no response body");
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        // eslint-disable-next-line no-cond-assign
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as
              | { kind: "token"; text: string }
              | { kind: "error"; message: string }
              | { kind: "done"; durationMs: number; exitCode: number | null }
              | { kind: "saved"; path: string; bytes: number };
            if (evt.kind === "token") {
              setResponse((prev) => prev + evt.text);
            } else if (evt.kind === "error") {
              setError(evt.message);
            } else if (evt.kind === "saved") {
              setSavedPath(evt.path);
            }
          } catch {
            /* skip malformed line */
          }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(String(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const selectedAgent = agents.find((a) => a.name === selected);

  return (
    <main>
      <h1>Agentic OS — Phase 1A</h1>
      <p>
        <small>
          Kernel skeleton. Plain HTML on purpose — see <code>docs/ROADMAP.md</code>{" "}
          (the Tailwind / Framer Motion port lands in Phase 1B).
        </small>
      </p>

      <hr />

      <h2>Agents ({agents.length})</h2>
      {agents.length === 0 ? (
        <p>(none loaded — check <code>agents/builtin/</code>)</p>
      ) : (
        <ul>
          {agents.map((a) => (
            <li key={a.name}>
              <code>{a.name}</code> — {a.displayName} <em>({a.transport})</em>
              {a.description ? <> · {a.description}</> : null}
            </li>
          ))}
        </ul>
      )}

      <hr />

      <h2>Run an agent</h2>
      <div>
        <label>
          Agent:&nbsp;
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={running}
          >
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.displayName} ({a.name})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ marginTop: "0.5rem" }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          cols={80}
          placeholder="Type a prompt and click Send…"
          disabled={running}
        />
      </div>

      <div style={{ marginTop: "0.5rem" }}>
        {running ? (
          <button onClick={stop}>Stop</button>
        ) : (
          <button onClick={runPrompt} disabled={!selected || !prompt.trim()}>
            Send to {selectedAgent?.displayName ?? "agent"}
          </button>
        )}
      </div>

      {error && (
        <p style={{ color: "crimson" }}>
          <strong>Error:</strong> {error}
        </p>
      )}

      <h3>Response</h3>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          border: "1px solid #ccc",
          padding: "0.5rem",
          minHeight: "6rem",
          background: "#fafafa",
        }}
      >
        {response || (running ? "thinking…" : "(no response yet)")}
      </pre>
      {savedPath && (
        <p>
          <small>
            saved → <code>{savedPath}</code>
          </small>
        </p>
      )}

      <hr />

      <h2>Live event bus (newest first)</h2>
      <p>
        <small>
          GET <code>/api/events</code> · last {events.length} of 50 shown
        </small>
      </p>
      <ul style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }}>
        {events.map((e) => (
          <li key={e.id}>
            <code>{new Date(e.ts).toISOString().slice(11, 19)}</code>{" "}
            <strong>{e.source}</strong> {e.kind}
            {e.payload !== undefined ? (
              <> &nbsp;<small>{JSON.stringify(e.payload)}</small></>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
