import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata = {
  title: "Agentic OS",
  description: "Local mission control for AI agents",
};

// The shell resolves the feature registry per request (Shell.tsx reads
// the operator config). Force dynamic rendering so toggling a feature
// in config is reflected on the next reload — a build-time prerender
// would freeze the registry-driven shell at install-time state.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
