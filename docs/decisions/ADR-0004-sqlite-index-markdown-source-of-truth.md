# ADR-0004 — SQLite FTS5 index, markdown stays source of truth

**Status:** Accepted
**Date:** 2026-05-16

## Context

The "Memory" pillar of Agentic OS depends on searching the operator's Obsidian vault. The operator's vault currently has ~40 markdown notes but will grow — the marketing copy on Julian's source page references operators with 1,261 voice notes plus 186 regular notes, all expected to be searchable.

Julian's v0.1 search (`src/lib/vault.ts → searchNotes`) is a linear `indexOf` over every file in the vault on every query. Concrete behavior:

- Reads every file's full content into memory for each search.
- Single-substring match only — no token-aware scoring, no phrase queries, no boolean operators.
- O(N · M) per query where N = file count and M = average file size.

At ~50 files this is fine. At ~5000 it's seconds per query. At ~50,000 (achievable with voice transcripts) it's broken.

We need a real index. The options:

1. **SQLite FTS5** — built into SQLite, very fast full-text search, no extra service.
2. **External full-text search engine** (Meilisearch, Tantivy, Elasticsearch).
3. **In-memory inverted index** built on startup.
4. **Embedding-based semantic search only** (LanceDB, qdrant, sqlite-vec).

Markdown remains the canonical store either way. The question is the index.

## Decision

A SQLite database at `~/.agentic-os/index.db` with FTS5 virtual tables over note title, body, and select frontmatter values. The index is **derived state** — it can be deleted at any time and the kernel will rebuild it from the vault on next start.

A `chokidar` watcher on the vault root keeps the index incrementally fresh. No watcher → the kernel does a stat-based delta on startup.

**Semantic search is deferred to Phase 2** as a separate `sqlite-vec` extension table (`vec_notes`) holding embeddings produced by a local model (e.g., `nomic-embed-text` via Ollama). FTS5 remains the primary; vec is a complement, not a replacement.

Markdown files are never modified by the indexer. The vault `.md` files remain the operator's canonical, human-editable, git-versioned store.

## Consequences

**Positive**

- Sub-millisecond queries at vault sizes well into six figures.
- FTS5 supports phrase queries, prefix queries, NEAR operators, BM25 ranking. Enough for the dashboard's needs.
- No external service to install or keep running. One file. Embedded in the Node process via `better-sqlite3`.
- If the index gets corrupted: `rm ~/.agentic-os/index.db` and restart. No data loss.
- Phase 2 semantic search lands as a column addition + new query path; no schema migration.

**Negative**

- `better-sqlite3` is a native module with a compile step on install. Adds friction to clean clones, especially on platforms without a prebuilt binary. Mitigation: pin a known-good version and document the prereq in INSTALL.md.
- Two stores to keep in sync: filesystem markdown and SQLite. The watcher handles the common case but rare race conditions are possible. Mitigation: drift detector that re-stat-scans every N hours and flags discrepancies in the audit log.
- Frontmatter indexing requires a YAML parser. Trivial dependency but one more thing.

**Neutral**

- The watcher is per-process. Multiple Agentic OS instances pointed at the same vault would step on each other. Out of scope (single-operator system).

## Alternatives considered

- **Linear grep (Julian's current approach).** See Context — doesn't scale.
- **Meilisearch / Tantivy server.** Heavyweight: another daemon to install, configure, keep updated. Excellent if we needed multi-process or multi-host search. We don't.
- **In-memory inverted index, rebuilt on every startup.** Memory-hungry at large vault sizes. Slow startup. Loses on every metric vs. SQLite.
- **Semantic-only via a vector store.** Vector search alone is bad at literal-string queries ("find that note where I wrote `openclaw gateway restart`"). Both kinds of recall matter; FTS5 handles one cheaply.

## References

- SQLite FTS5: https://www.sqlite.org/fts5.html
- sqlite-vec: https://github.com/asg017/sqlite-vec
- [`docs/ARCHITECTURE.md#5-knowledge-layer`](../ARCHITECTURE.md#5-knowledge-layer).
