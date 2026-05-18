"use client";

// Slim TopBar: just the page-identity block (clock + LOCAL overline +
// 34px title + subtitle). The ⌘K and ALL SYSTEMS chips live in the
// sidebar (Slice 2 revised), so this header is title-only — no
// right-cluster, no large chrome.

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { resolveTitle } from "@/lib/titles";

export default function TopBar() {
  const pathname = usePathname() ?? "/";
  const t = resolveTitle(pathname);
  const [time, setTime] = useState<string>("");
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const setNow = () =>
      setTime(
        new Date().toLocaleTimeString("en-GB", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    setNow();
    const id = setInterval(setNow, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.header
      key={pathname}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.35 }}
      className="min-w-0 mb-8"
    >
      <div
        className="text-[11px] uppercase tracking-[0.22em] text-[var(--fg-dimmer)] mb-1"
        suppressHydrationWarning
      >
        {time || "—"} · Local
      </div>
      <h1 className="text-[34px] leading-[1.05] font-medium tracking-tight">
        {t.title}
      </h1>
      <p className="mt-2 text-[14px] text-[var(--fg-dim)] max-w-xl">{t.sub}</p>
    </motion.header>
  );
}
