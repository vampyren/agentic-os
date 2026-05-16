import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import CommandPalette from "./CommandPalette";

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        <div className="flex-1 px-6 md:px-10 py-6 max-w-[1400px] w-full mx-auto">
          {children}
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
