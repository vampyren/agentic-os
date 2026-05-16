import type { ReactNode } from "react";

export const metadata = {
  title: "Agentic OS (Phase 1A)",
  description: "Local mission control for AI agents — kernel skeleton.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "1rem" }}>
        {children}
      </body>
    </html>
  );
}
