# Security

This is a single-operator, single-machine system in Phase 1. The security posture reflects that. Phase 3 adds a real auth boundary; until then, the surface is intentionally minimal.

## Threat model (Phase 1)

**In scope**

- Accidental command injection via prompt content.
- Path traversal through vault read/write endpoints.
- An agent CLI behaving badly (hanging, leaking secrets in stdout, returning garbage).
- Secrets accidentally committed to the repo.
- A misconfigured agent manifest causing unexpected subprocess execution.

**Out of scope (Phase 1) — deferred to Phase 3**

- Multi-user authorization.
- Remote attacker on the network.
- Compromised host (we don't try to defend against a machine that's already owned).
- Side-channel attacks against the operator's secrets.

## Network posture

- The Next.js server binds **127.0.0.1 only**. No `0.0.0.0`, no exposed port.
- CORS rejects any origin other than `http://127.0.0.1:3000` and `http://localhost:3000`.
- No HTTPS in Phase 1 — local loopback only.
- Phase 3 will introduce `--bind 0.0.0.0` + bearer-token auth. Until then, the only access path is the operator's own browser on the same machine.

## Subprocess execution

All subprocess calls go through a single helper (`src/kernel/spawn.ts`). Rules:

- `spawn(bin, argv, opts)` with `shell: false`. **Never `exec`, never `spawn(..., { shell: true })`.**
- Arguments are arrays of strings. The prompt is one array element. No shell interpolation of any kind.
- Null bytes in any argument → reject before spawn.
- Max argument length: 32KB per arg.
- **Environment is built from a strict allowlist, not inherited wholesale.** The parent process's env is filtered through `ENV_ALLOWLIST` in `spawn.ts` (PATH, HOME, USER, SHELL, TERM, LANG, LC_*, TZ, TMPDIR, XDG_*, NODE_PATH). Plus any var starting with `AGENTIC_OS_` is forwarded unconditionally (our own config namespace). `NO_COLOR=1` and `FORCE_COLOR=0` are forced. Manifest-declared `env:` blocks add to that on top.
  - **Why this matters:** API keys and tokens in your shell env (`OPENAI_API_KEY`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, etc.) would otherwise be forwarded to every agent CLI whether the manifest asked for them or not. The allowlist prevents that.
  - **If a CLI breaks because it needed a var not on the allowlist:** add the var to its manifest's `env:` block (manifest-declared additions always win). Don't expand the global allowlist unless the var is universally safe.
- Process timeout: per-transport. Subprocess default 120s. Streaming has no hard timeout but the operator can cancel from the UI (which sends `SIGTERM`).

## CLI verb allowlist (`/api/run`)

The action panels in the UI call CLI verbs like `openclaw doctor` or `hermes status`. These go through `/api/run`, which:

- Accepts only manifests' declared `verbs:` entries.
- Each verb's args are matched by regex; mismatches are rejected with 403.
- The prompt body of a chat is never passed through `/api/run` — chats go through transport-specific endpoints that take a single `prompt` field, validated and length-capped.

## Vault path safety

- Vault root is loaded once from config and resolved with `path.resolve`.
- Every vault read/write path is normalized and rejected if `!resolved.startsWith(vaultRoot)`.
- File extension whitelist: `.md` only for the read API. (Writes always go through the writer module, which controls extensions itself.)
- Skip list: `.obsidian/`, `.trash/`, `.git/`, `node_modules/`, `60_Attachments/`.

## Secrets

**Lookup priority (strict, no fallback to defaults):**

1. Environment variable (matching the manifest's `env:` mapping).
2. `~/.agentic-os/secrets.yaml`.
3. If neither resolves: **refuse to start the agent and surface a `missing-secret` error in the UI.** Never silently degrade.

**Hard rules — never violated, anywhere:**

- API keys live at `~/.agentic-os/secrets.yaml`. Permissions are forced to `0600` on first read; if the file is world- or group-readable, the kernel logs a warning and refuses to load it.
- Secrets are looked up by dotted path from a manifest's `secrets:` block (e.g., `openrouter.apiKey` resolves to `secrets.openrouter.apiKey`).
- **Never logged.** The kernel scrubs known secret values from stdout/stderr capture before writing to the audit log.
- **Never sent to the browser.** The frontend only sees a redacted `{ hasKey: true }` flag per agent.
- **Never in audit log.** Request headers carrying `Authorization` or `x-api-key` are stripped before logging; bodies are summarized (`length` + `sha256[:8]`), not stored.
- **Never in error messages shown to the user.** Stack traces from `http` transports are sanitized before bus emission.
- Config files at `~/.agentic-os/` are not, and must not be, committed to the repo. The default `.gitignore` excludes them.

## Audit log

Append-only, one file per UTC day, JSONL format:

```
~/.agentic-os/audit/YYYY-MM-DD.jsonl
```

Each line is a single JSON object. Example records (real shape from `src/kernel/audit.ts` as of v0.2.4):

```json
{"ts":"2026-05-16T10:12:00.123Z","id":"...","kind":"agent.invoke","agent":"claude-code","transport":"streamJson","bin":"claude","argsRedacted":["-p","--output-format=stream-json","--include-partial-messages","--verbose","[PROMPT_REDACTED]"],"promptSha256":"a1b2c3d4","promptChars":312}
{"ts":"2026-05-16T10:12:12.500Z","id":"...","kind":"agent.invoke.complete","agent":"claude-code","durationMs":12345,"exitCode":0,"bytesOut":1024,"status":"success"}
{"ts":"2026-05-16T10:12:13.456Z","id":"...","kind":"vault.write","agent":"claude-code","path":"00_Inbox/agentic-os/chats/2026-05-16-1012-claude-code-a1b2c3d4.md","action":"create","bytes":4821}
{"ts":"2026-05-16T10:12:14.789Z","id":"...","kind":"agent.invoke.error","agent":"some-agent","errorClass":"non-zero-exit","exitCode":7,"stderrSha8":"deadbeef","stderrChars":142,"transport":"subprocess"}
```

**Kinds (current set):** `agent.invoke`, `agent.invoke.complete`, `agent.invoke.error`, `vault.write`, `vault.update`. Future kinds reserved: `vault.promote`, `secrets.read`, `verb.run`, `mission.run`, `system.boot`, `system.shutdown`.

**Note on `agent.invoke.error`:** never carries a raw `message` field. Per the SEC-001 fix in v0.2.4, only neutral metadata is recorded — `errorClass` (one of `non-zero-exit` / `spawn-failed` / `timeout` / `killed` / `transport-error` / `unknown`), `exitCode`, `stderrSha8` (8-char correlation hash), `stderrChars` (length), and `transport`. The raw stderr/error text stays on the in-memory bus for live UI display but never reaches JSONL. This guards against agent CLIs that echo the prompt to stderr.

**Redaction rules:**

- **Prompts: never logged verbatim — anywhere in the JSONL.** Two cooperating mechanisms guarantee this, both with regression tests:
  1. **`argsRedacted` is clean.** The registry builds the audit-version of argv via `renderArgsForAudit()` in `src/kernel/spawn.ts`, which substitutes `{prompt}` with the literal placeholder `[PROMPT_REDACTED]` before the args ever reach the audit module. Then `auditAgentInvoke` stores `promptSha256` (first 8 hex of SHA-256) + `promptChars` as separate fields.
  2. **`vault.write` paths are clean.** Chat filenames are derived from a **hash** of the prompt, not from prompt text: `YYYY-MM-DD-HHMM-{agent}-{promptSha8}.md`. Filenames contain only 8 hex chars of SHA-256(prompt) — never any prompt-derived characters. The H1 title and chat body inside the markdown remain human-readable (those live in the operator's vault, not the audit log).
  3. **`tests/audit-pipeline-security.test.ts` is the nonce assertion**: creates a chat with a unique nonce in title + body + filename-seed and asserts the nonce appears **nowhere** in the JSONL — not in `argsRedacted`, not in any `vault.write` path, not in any payload, not in any string field of any entry. Both a raw-string scan and a recursive walk of every parsed entry must pass.
- **Other note kinds (goals, journal, summaries, reviews, drafts) keep slugified filenames** because the title is operator-authored — not prompt content. The slug reflects what the operator typed into the dashboard, which they already know.
- Args: any value matching a known secret env-var name pattern (`API_KEY|TOKEN|SECRET|PASSWORD|Bearer`) is replaced with `[REDACTED]` as a second-layer defense (in addition to the `[PROMPT_REDACTED]` substitution above).
- HTTP bodies: never logged. Only `status`, `durationMs`, `bytesIn`, `bytesOut`.

**Rotation:** one file per day, kept for 30 days, then deleted. The operator can disable rotation with `audit.retentionDays: 0` (keeps forever) or change it.

**Why JSONL not plain text:** the audit log becomes searchable with one-liners (`jq 'select(.kind == "vault.write")' audit/2026-05-16.jsonl`), and the Phase 1B SQLite index can ingest it directly to power a dashboard activity view.

## What an attacker with local user access can do

Honest answer: pretty much anything. The OS doesn't try to defend against a malicious process running as the same user. It has the operator's vault, the operator's secrets, the operator's Claude subscription. The defense at this layer is the OS itself, not Agentic OS.

The contract Agentic OS does honor:

- It will not silently exfiltrate vault contents (no telemetry, no HTTP calls outside the manifests the operator has configured).
- It will not write to the vault outside the inbox-first contract.
- It will not bypass its own audit log.

## Browser localStorage — per-agent chat history

Since v0.2.7 the dashboard mirrors each agent's chat session to the browser's `localStorage` under keys `agentic-os.chat.<agent-name>`. Stored payload includes the full message text (operator prompts AND assistant responses), per-message usage stats, the saved vault path, and cumulative session usage.

**Why it exists:** so the operator's active conversation survives a page reload. Without it, refreshing the browser would lose the in-flight conversation even though the chat is also being written to the Obsidian vault (vault is the canonical record; localStorage is the active-session cache).

**Scope of the data:** any process running as the operator's user with browser-data read access can read it (same as cookies, IndexedDB, etc.). Not a new attack surface vs. the existing model — but worth flagging because it expands what "if someone has access to your machine" exposes:

| Before v0.2.7 | After v0.2.7 (today) |
|---|---|
| Chat exists in vault (`00_Inbox/agentic-os/chats/...md`) | Same — vault unchanged |
| Audit log holds `promptSha256` only (no raw prompts) | Same — audit unchanged |
| In-flight conversation in browser memory, lost on reload | Same browser memory **plus** `localStorage` per agent |

**Clearing the cache** (operator-side options):
- Click the **New session** button in the AgentRoom header — clears that agent's history (chat + sessionUsage + lastUsage) and removes the localStorage key.
- Browser DevTools → Application → Local Storage → delete all keys starting with `agentic-os.chat.`.
- `localStorage.clear()` in the browser console — nukes everything for `127.0.0.1:3000`.
- A "Clear all chat cache" affordance in the UI is queued for a future release.

**Future: opt-out.** A `localStorage` opt-out (operator setting → in-memory only, lose-on-reload) is on the roadmap. Today it's always on; nothing gated.

## Aborts, races, and reloads — guaranteed behavior

| Scenario | Behavior |
|---|---|
| Operator clicks **New session** during a streaming response | The fetch is aborted (SIGTERM to subprocess via AbortController), the chat history is cleared. A generation counter prevents the aborted run's `finally` block from writing "(no output)" or partial output back to the cleared session. (v0.2.8 fix — Hermes review of v0.2.7.) |
| Operator navigates to a different agent during a streaming response | AgentRoom's unmount cleanup aborts the fetch and bumps the send-generation counter (v0.2.10 — was claimed in v0.2.7 docs but the code wasn't delivering until now; caught by Hermes v0.2.8 review). The aborted run's `finally` block detects it's no longer the current generation and skips committing to the store. Switching back to the original agent shows the chat as it was at abort time (last completed message; the in-flight one is dropped). |
| Page reload during a streaming response | The fetch dies with the page. Last committed message is restored from localStorage on reload. The in-flight partial response is lost; the operator can re-send. The kernel/subprocess on the server side keeps running until it naturally exits (the cancel signal arrives via the closed HTTP body). |
| Two browser tabs open to the same agent | Both subscribe to the same `chatStore` singleton (within a tab) but separate tabs have separate stores. Send-from-tab-A doesn't appear in tab-B. Both tabs DO read/write the same localStorage on commit, so reloading either tab eventually converges. Multi-tab simultaneity isn't a supported workflow yet. |
| Kernel-side audit on aborted streams | The aborted run still writes `agent.invoke.complete` with the actual exit/duration (or `agent.invoke.error` with `errorClass: "killed"` if the signal terminated the subprocess). |

## Reporting

Until this project has any meaningful user base, security reports come via GitHub issues (`vampyren/agentic-os`) tagged `security`. After a real release, this section will be updated with a private-disclosure path.
