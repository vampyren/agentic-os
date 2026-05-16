"use client";

import { useEffect, useState } from "react";
import Pill from "./Pill";

interface VitalsResponse {
  ts: number;
  agents: Array<{
    name: string;
    displayName: string;
    status: "live" | "degraded" | "offline" | "unknown";
    latencyMs?: number;
  }>;
}

export default function TopBar() {
  const [vitals, setVitals] = useState<VitalsResponse | null>(null);
  // `now` is null on the initial server render so the SSR/CSR HTML matches
  // (the clock value would otherwise diverge by milliseconds). After mount
  // we set it on the client and update once per second.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/vitals", { cache: "no-store" });
        if (r.ok) setVitals(await r.json());
      } catch {
        /* network blip — keep last value */
      }
    };
    tick();
    setNow(new Date());
    const id = setInterval(tick, 15_000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, []);

  return (
    <header className="flex items-center justify-between gap-4 px-6 md:px-10 py-4 border-b border-[var(--border)] sticky top-0 z-10 backdrop-blur bg-[rgba(8,9,11,0.7)]">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[15px] tracking-tight font-medium">
          Mission Control
        </h1>
        <span
          className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]"
          suppressHydrationWarning
        >
          {now ? `${now.toLocaleTimeString("en-GB", { hour12: false })} local` : "—"}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap justify-end">
        {vitals?.agents.length ? (
          vitals.agents.map((a) => (
            <Pill key={a.name} tone={a.status} pulse={a.status === "live"}>
              {a.name}
            </Pill>
          ))
        ) : (
          <Pill tone="unknown">vitals loading</Pill>
        )}
      </div>
    </header>
  );
}
