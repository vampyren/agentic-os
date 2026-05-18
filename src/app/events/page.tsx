"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { accentFor } from "@/lib/accent";

interface BusEvent {
  id: string;
  ts: number;
  source: string;
  kind: string;
  payload?: unknown;
}

export default function EventsPage() {
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        const evt = JSON.parse(m.data) as BusEvent;
        setEvents((prev) => [evt, ...prev].slice(0, 200));
      } catch { /* keepalive */ }
    };
    return () => es.close();
  }, []);

  const filtered = filter
    ? events.filter((e) =>
        e.source.includes(filter) ||
        e.kind.includes(filter) ||
        JSON.stringify(e.payload ?? "").includes(filter),
      )
    : events;

  return (
    <div className="flex flex-col gap-4 min-h-[60vh]">
      <header className="flex items-baseline justify-end">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter…"
            className="text-[12px] w-48"
          />
          <span className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">
            {filtered.length} / {events.length} · streaming
          </span>
        </div>
      </header>

      <div className="panel flex-1 overflow-hidden">
        <ul className="divide-y divide-[var(--border)] overflow-y-auto scroll max-h-[70vh]">
          <AnimatePresence initial={false}>
            {filtered.map((e) => (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="px-5 py-2 text-[12px] grid grid-cols-[80px_140px_220px_1fr] gap-3 items-baseline"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                <span className="text-[var(--fg-dimmer)]">
                  {new Date(e.ts).toISOString().slice(11, 19)}
                </span>
                <span className="font-medium" style={{ color: accentFor(e.source) }}>
                  {e.source}
                </span>
                <span className="text-[var(--fg-dim)]">{e.kind}</span>
                <span className="text-[var(--fg-dimmer)] truncate">
                  {e.payload !== undefined ? JSON.stringify(e.payload) : ""}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
