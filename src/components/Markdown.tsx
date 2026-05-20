"use client";

// Markdown renderer for agent chat responses and vault-note previews.
// Wraps react-markdown with our dark-theme styling and highlight.js for
// code blocks.
//
// Security contract:
// - Do NOT add rehype-raw.
// - Do NOT enable allowDangerousHtml.
// Agent output and vault notes can contain untrusted markdown. Keeping raw
// HTML disabled means tags like <script> or <img onerror=...> render as text
// instead of executable DOM.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
