import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import CommandPalette from "./CommandPalette";

export default function Shell({ children }: { children: ReactNode }) {
  return (
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
  );
}
