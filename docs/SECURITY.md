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

## Per-agent Control Room actions (`/api/agents/[name]/actions/[action]`)

The Control Room view on each agent page (introduced in v0.2.11) lets the operator run read-only CLI verbs like `hermes status`, `hermes sessions list`, `hermes doctor`, `hermes insights`. These go through `/api/agents/[name]/actions/[action]`. Hardening contract:

- **Manifest allowlist.** Each agent's YAML manifest declares an optional `actions: [...]` block (zod-validated at load — see `docs/AGENT-MANIFEST.md`). Each entry is `{ id, label, command: string[], timeoutMs?, hint?, output? }`. Cap of 10 actions per agent. Unknown agent → 404 `unknown-agent`; unknown action → 404 `unknown-action`. Neither triggers an audit write or bus event.
- **`safeSpawn` only.** Same helper as the chat path. argv arrays only — no `shell: true`. Null bytes in args rejected. 32 KB max arg length. Environment built from `ENV_ALLOWLIST` per the rule above; manifest `env:` additions on top.
- **Per-stream byte cap.** 256 KiB on stdout AND stderr each. Beyond the cap, the child is killed with `SIGKILL` and the response carries `truncated: true`.
- **Per-action timeout.** Default **5s**, clamped at **60s max** at the route level (raised from the original 10s during v0.2.11 so legitimately-slow read-only verbs like `hermes insights` can finish). Each manifest action may override `timeoutMs` up to that ceiling.
- **Output sanitisation before the UI sees it.** Captured stdout/stderr passes through `src/kernel/textSanitize.ts`:
  - `stripAnsi()` removes terminal escape sequences (CSI / SGR / OSC / single-char ESC) — without it, the browser `<pre>` would render literal `\x1b[1m` / `\x1b[0m` artifacts.
  - CRLF is normalised to LF; bare CR (progress-bar `\r` redraws) is dropped.
  - `clampLines()` truncates any single line longer than 1000 chars with a visible `… [+N chars]` marker. This catches pathological rows like a `hermes sessions list` Preview cell that dumps a multi-kilobyte system prompt — the rest of the row's columns stay readable.
- **Raw output stays operator-private.** The cleaned output is returned in the localhost-only HTTP response body so the Control Room viewer can render it. It is **NEVER** written to the JSONL audit log. Action stdout from `hermes sessions list` / `hermes insights` legitimately contains prompt previews and model output; same prompt-leak risk that drove v0.2.4's stderr fix applies here.
- **Audit + bus lengths reflect CLEANED text.** `auditAgentAction` records `stdoutChars` / `stderrChars` computed AFTER `stripAnsi` + `clampLines` — matches what the operator actually saw in the viewer. Same for the bus event payload.
- **Neutral classified errors.** On non-zero exit / timeout / spawn failure, `classifyAgentError` returns a fixed enum (`spawn-failed | timeout | killed | non-zero-exit | transport-error | unknown`). `neutralErrorMessage` returns a stock phrase per class. The UI error text is **never derived from raw stderr** — that text could echo a prompt.
- **Fail-soft contract.** An action error (HTTP 200 with `{ ok: false, errorClass, errorMessage }`) is a UI hint only. The chat textarea, Stop button, chat history, and any other agent's Control Room are untouched. ControlRoom holds a per-action AbortController + generation counter so a slow chip can't write into a re-clicked or unmounted room.

Chats go through a separate transport-specific endpoint (`/api/agents/[name]/run`) that takes a single length-capped `prompt` field — never through the actions route.

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

## Phase 1C — integration spine (M1–M3)

The Phase 1C foundation adds config sections for connectors, MCP
servers, and missions. New security contracts:

- **`authRef`-only secret handling.** A connector config carries a
  secret *reference*, never the secret. `authRef` is a string matching
  `env:VAR_NAME` or `none`, validated by regex at config-parse time and
  never resolved into the in-memory config object. The referenced env
  var is read later, at use time, in the connector runtime layer.
- **No opaque connector config bag.** A connector entry's schema is
  `.strict()` and has *no* free-form `config` field. An arbitrary
  `z.unknown()` dictionary would let raw secrets (`apiKey`, `token`,
  `password`) live in plain YAML — exactly what `authRef` exists to
  prevent. Typed, named connector-specific settings get added per
  connector when real connectors land; until then any `config:` key is
  rejected. (PR #8 review blocker B1; ADR-0010.)
- **Capability Router neutral failure contract.** The router never
  passes a connector's failure detail through. A thrown error and a
  returned `{ status: "failed" }` are both collapsed to a generic
  `errorCode` + message — the connector's own `message` / `errorCode` /
  `metadata` is dropped, since none of it is trusted to be secret-free.
  `success` results still carry `output` / `metadata`. (ADR-0012; tests
  in `tests/capability-router.test.ts`.)
- **Vault output allowlist.** A mission's output folder must be one of a
  fixed allowlist of `00_Inbox/agentic-os/...` roots
  (`src/lib/vaultPaths.ts`, branded `VaultRelativePath`). The check is
  lexical — relative path, no `..`, no backslash, path-segment-boundary
  match — and runs at config-parse time and in the effective-plan
  resolver.
- **M4 constrained-writer expectation (not yet built).** Missions
  return output objects; a central runner (M4) writes vault notes
  through a *constrained writer*. That writer must, at write time,
  re-resolve the target with `fs.realpath` and reject any path that
  escapes an allowlisted root via a symlink — the same realpath-escape
  pattern as the v0.2.12 cwd picker. The lexical M3 allowlist is
  necessary but not sufficient alone; the realpath check is mandatory
  before the first real mission write.

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
{"ts":"2026-05-17T05:32:11.123Z","id":"...","kind":"agent.action","agent":"hermes","actionId":"sessions","exitCode":0,"durationMs":1652,"stdoutChars":1480,"stderrChars":0,"status":"success"}
```

**Kinds (current set):** `agent.invoke`, `agent.invoke.complete`, `agent.invoke.error`, `agent.action`, `vault.write`, `vault.update`. Future kinds reserved: `vault.promote`, `secrets.read`, `verb.run`, `mission.run`, `system.boot`, `system.shutdown`.

**Note on `agent.action`:** neutral metadata only — `agent`, `actionId`, `exitCode`, `durationMs`, `stdoutChars`, `stderrChars`, `status`, optional `errorClass`. **Never carries raw stdout/stderr.** Lengths reflect cleaned text (post `stripAnsi` + `clampLines`). See the Control Room actions section above for the full hardening contract.

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

## Known limitations and residual risks

### Localhost trust model for non-browser callers

`src/app/api/_lib/cors.ts` combines two browser-facing checks:
- `Origin` allowlist: only `http://127.0.0.1:3000` and `http://localhost:3000` are accepted when an `Origin` header is present.
- `Sec-Fetch-Site` gate: browser requests from `same-site` or `cross-site` contexts are rejected, including simple cross-origin GET shapes that may omit `Origin`.

The remaining intentional allowance is for non-browser local callers such as curl or local scripts. Those clients usually send neither `Origin` nor `Sec-Fetch-Site`, so they pass under the Phase 1 localhost-single-operator trust model.

Scope:
- Highest-risk surface: `GET /api/agents/[name]/actions/[action]` because it spawns read-only subprocess actions. Browser cross-site/same-site triggers are blocked by the `Sec-Fetch-Site` gate; local non-browser tools remain trusted.
- Lower-risk: `GET /api/memory/note?path=` is read-only and still protected by path traversal checks plus same-origin response protections.
- POST endpoints rely on the same Origin/Sec-Fetch-Site gate and input validation.

Possible future hardening: split browser endpoints from local automation endpoints, require a local bearer token for side-effecting non-browser calls, or add a stricter action-only gate if Agentic OS moves beyond single-operator localhost use.

Operator mitigations:
- Don't run untrusted local dev tools on other ports while the dashboard is up.
- Treat the dashboard as a localhost-only single-tenant tool (which is already the Phase 1 posture per the threat model above).

## Reporting

Until this project has any meaningful user base, security reports come via GitHub issues (`vampyren/agentic-os`) tagged `security`. After a real release, this section will be updated with a private-disclosure path.
