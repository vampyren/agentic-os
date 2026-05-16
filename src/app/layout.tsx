import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata = {
  title: "Agentic OS",
  description: "Local mission control for AI agents",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
