import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import CommandPalette from "./CommandPalette";

export default function Shell({ children }: { children: ReactNode }) {
  // MotionConfig reducedMotion="user" tells framer-motion the whole tree
  // intentionally respects the OS-level prefers-reduced-motion setting.
  // Two effects:
  //   1. Silences framer's dev-mode "You have Reduced Motion enabled"
  //      console warning (fires whenever useReducedMotion() returns true
  //      in dev mode, even when we're handling the preference correctly).
  //   2. Framer automatically reduces motion on tweens/springs when the
  //      user prefers reduced motion — additive to our explicit
  //      useReducedMotion() gates and the CSS @media block in globals.css.
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex relative">
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Content hugs the sidebar — no mx-auto centering. max-w cap keeps
              line-lengths sensible on ultra-wide monitors but the block stays
              left-aligned so there's no dead space between sidebar and content. */}
          <div className="flex-1 px-6 md:px-10 py-6 max-w-[1400px] w-full">
            <TopBar />
            {children}
          </div>
        </main>
        <CommandPalette />
      </div>
    </MotionConfig>
  );
}
