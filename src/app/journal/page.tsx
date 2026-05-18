"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";

interface Entry {
  time: string;
  text: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function JournalPage() {
  const [date, setDate] = useState<string>(todayIso());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recentDays, setRecentDays] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDay(d: string) {
    setError(null);
    try {
      const r = await fetch(`/api/journal?date=${encodeURIComponent(d)}`, { cache: "no-store" });
      if (r.ok) setEntries((await r.json()).entries ?? []);
    } catch (e) { setError(String(e)); }
  }
  async function loadDays() {
    try {
      const r = await fetch(`/api/journal?recent=30`, { cache: "no-store" });
      if (r.ok) setRecentDays((await r.json()).days ?? []);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadDay(date); }, [date]);
  useEffect(() => { loadDays(); }, []);

  async function append() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(await r.text());
      setText("");
      await Promise.all([loadDay(date), loadDays()]);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const isToday = date === todayIso();

  return (
    <div className="grid lg:grid-cols-[1fr_220px] gap-6">
      <div className="flex flex-col gap-4 max-w-3xl">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--fg-dimmer)]">
            Entries for {date}{isToday && <span className="ml-2 normal-case tracking-normal text-[var(--fg-dim)]">(today)</span>}
          </div>
          <p className="text-[12px] text-[var(--fg-dim)] mt-1">
            One file per day under <code>00_Inbox/agentic-os/journal/</code>. Each entry is timestamped.
          </p>
        </div>

        {isToday && (
          <div className="panel p-4 flex gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); append(); }
              }}
              rows={3}
              placeholder="What's on your mind?  ⌘+Enter to log"
              className="flex-1 text-[13px] resize-none"
              disabled={busy}
            />
            <button onClick={append} disabled={!text.trim() || busy} className="self-end">
              <span className="flex items-center gap-1.5"><Plus size={13} />Log</span>
            </button>
          </div>
        )}

        {error && <div className="text-[12px] text-rose-300">{error}</div>}

        {entries.length === 0 ? (
          <p className="text-[13px] text-[var(--fg-dim)]">
            {isToday ? "No entries yet today." : "No entries on this day."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {entries.map((e, i) => (
                <motion.div
                  key={`${e.time}-${i}`}
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className="panel px-4 py-3"
                >
                  <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">
                    {e.time}
                  </div>
                  <div className="text-[13px] whitespace-pre-wrap leading-relaxed">
                    {e.text}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <aside className="hidden lg:block">
        <h3 className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-2 px-3">
          Recent days
        </h3>
        <ul className="flex flex-col">
          {recentDays.length === 0 ? (
            <li className="text-[12px] text-[var(--fg-dim)] px-3 py-2">none yet</li>
          ) : (
            recentDays.map((d) => (
              <li key={d}>
                <button
                  onClick={() => setDate(d)}
                  className={`!border-0 !bg-transparent !text-left w-full !px-3 !py-1.5 text-[12px] !rounded-md ${
                    d === date ? "!text-[var(--fg)] !bg-[var(--bg-elevated-hot)]" : "!text-[var(--fg-dim)] hover:!text-[var(--fg)]"
                  }`}
                >
                  {d}{d === todayIso() && <span className="text-[var(--fg-dimmer)] ml-1">·today</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>
    </div>
  );
}
