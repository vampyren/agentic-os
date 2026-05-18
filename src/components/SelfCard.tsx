"use client";

// Mission Control Self-section card (Slice 3). Smaller than AgentPortal —
// one icon tile, title, tagline, single stat line. Subtle accent glow
// at the bottom-right corner.

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  href: string;
  title: string;
  tagline: string;
  icon: ReactNode;
  accent: string;
  stat: string;
}

export default function SelfCard({ href, title, tagline, icon, accent, stat }: Props) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <Link href={href} className="block group">
      <motion.div
        whileHover={prefersReducedMotion ? undefined : { y: -3 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.25 }}
        className="panel panel-hover p-5 relative overflow-hidden h-full"
      >
        <div
          className="pointer-events-none absolute -bottom-16 -right-12 w-48 h-48 rounded-full blur-3xl opacity-25 group-hover:opacity-50 transition"
          style={{ background: accent }}
        />
        <div className="relative flex items-start justify-between mb-3">
          <div
            className="grid place-items-center w-10 h-10 rounded-xl"
            style={{
              background: `color-mix(in srgb, ${accent} 18%, transparent)`,
              color: accent,
              boxShadow: `0 0 20px -8px ${accent}`,
            }}
          >
            {icon}
          </div>
          <ArrowUpRight
            size={14}
            className="text-[var(--fg-dimmer)] group-hover:text-[var(--fg)] opacity-50 group-hover:opacity-100 transition"
          />
        </div>
        <div className="relative">
          <h3 className="text-lg font-medium tracking-tight" style={{ color: accent }}>
            {title}
          </h3>
          <p className="mt-1 text-[12.5px] text-[var(--fg-dim)] leading-relaxed">{tagline}</p>
          <div className="mt-3 text-[10px] uppercase tracking-[0.2em] text-[var(--fg-dimmer)]">
            {stat}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
