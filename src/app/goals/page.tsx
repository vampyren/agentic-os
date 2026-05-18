"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Check, Circle } from "lucide-react";

interface Goal {
  path: string;
  title: string;
  category: string | null;
  goalStatus: "open" | "done";
  body: string;
  mtime: number;
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/goals", { cache: "no-store" });
      if (r.ok) setGoals((await r.json()).goals);
    } catch (e) { setError(String(e)); }
  }
  useEffect(() => { load(); }, []);

  async function createGoal() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, category: category || undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      setTitle("");
      setCategory("");
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function toggle(g: Goal) {
    const newStatus = g.goalStatus === "open" ? "done" : "open";
    setGoals((prev) => prev.map((x) => x.path === g.path ? { ...x, goalStatus: newStatus } : x));
    try {
      const r = await fetch("/api/goals/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: g.path, to: newStatus }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      setError(String(e));
      load();                           // revert from server
    }
  }

  const open = goals.filter((g) => g.goalStatus === "open");
  const done = goals.filter((g) => g.goalStatus === "done");

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <p className="text-[12px] text-[var(--fg-dim)]">
        One file per goal under <code>00_Inbox/agentic-os/goals/</code>.
        Promote to <code>10_Projects/</code> manually in Obsidian when ready.
      </p>

      {/* Add new */}
      <div className="panel p-4 flex gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createGoal(); }}
          placeholder="What's the goal?"
          className="flex-1 text-[13px]"
          disabled={busy}
        />
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="category (optional)"
          className="w-44 text-[12px]"
          disabled={busy}
        />
        <button onClick={createGoal} disabled={!title.trim() || busy}>
          <span className="flex items-center gap-1.5"><Plus size={13} />Add</span>
        </button>
      </div>

      {error && <div className="text-[12px] text-rose-300">{error}</div>}

      {/* Active */}
      <section>
        <h3 className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-3">
          Active ({open.length})
        </h3>
        {open.length === 0 ? (
          <p className="text-[13px] text-[var(--fg-dim)]">No active goals.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {open.map((g) => (
                <GoalItem key={g.path} g={g} onToggle={toggle} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {/* Done */}
      {done.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-3">
            Completed ({done.length})
          </h3>
          <ul className="flex flex-col gap-2 opacity-60">
            <AnimatePresence initial={false}>
              {done.map((g) => (
                <GoalItem key={g.path} g={g} onToggle={toggle} />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}
    </div>
  );
}

function GoalItem({ g, onToggle }: { g: Goal; onToggle: (g: Goal) => void }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="panel px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-elevated-hot)] transition"
    >
      <button
        onClick={() => onToggle(g)}
        className="!p-0 !border-0 !bg-transparent hover:!bg-transparent"
        aria-label={g.goalStatus === "done" ? "mark open" : "mark done"}
      >
        {g.goalStatus === "done" ? (
          <Check size={16} className="text-emerald-400" />
        ) : (
          <Circle size={16} className="text-[var(--fg-dim)] hover:text-[var(--fg)]" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] ${g.goalStatus === "done" ? "line-through" : ""}`}>
          {g.title}
        </div>
        {g.category && (
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mt-0.5">
            {g.category}
          </div>
        )}
      </div>
      <code className="text-[10px] text-[var(--fg-dimmer)] truncate max-w-[14rem]">
        {g.path.split("/").pop()}
      </code>
    </motion.li>
  );
}
