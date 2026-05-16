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

All subprocess calls go through a single helper (`src/lib/runner.ts` in Phase 1). Rules:

- `spawn(bin, argv, opts)` with `shell: false`. **Never `exec`, never `spawn(..., { shell: true })`.**
- Arguments are arrays of strings. The prompt is one array element. No shell interpolation of any kind.
- Null bytes in any argument → reject before spawn.
- Max argument length: 32KB per arg.
- Environment is the parent's env minus `FORCE_COLOR`, plus `NO_COLOR=1`. No additional secrets in env unless the manifest's `secrets:` block explicitly maps them.
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

- API keys live at `~/.agentic-os/secrets.yaml`. Permissions are forced to `0600` on first read; if the file is world- or group-readable, the kernel logs a warning and refuses to load it.
- Secrets are looked up by dotted path from a manifest's `secrets:` block (e.g., `openrouter.apiKey` resolves to `secrets.openrouter.apiKey`).
- Secrets are **never logged**. The kernel scrubs known secret values from stdout/stderr capture before writing to the audit log.
- Secrets are **never** sent to the browser. The frontend only sees a redacted `{ hasKey: true }` flag per agent.
- Config files at `~/.agentic-os/` are not, and must not be, committed to the repo. The default `.gitignore` excludes them.

## Audit log

`~/.agentic-os/audit.log` is append-only and records:

- Every agent invocation: timestamp, agent name, transport, sanitized prompt (first 200 chars), exit code, duration.
- Every vault write: timestamp, agent (or `operator`), file path, action (`create` / `append` / `promote`).
- Every secrets read: timestamp, key path, requesting agent.
- Every `/api/run` invocation: timestamp, agent, verb, exit code.

Rotation: daily, kept for 30 days, then deleted. The operator can disable rotation by setting `audit.retentionDays: 0` (keeps forever).

## What an attacker with local user access can do

Honest answer: pretty much anything. The OS doesn't try to defend against a malicious process running as the same user. It has the operator's vault, the operator's secrets, the operator's Claude subscription. The defense at this layer is the OS itself, not Agentic OS.

The contract Agentic OS does honor:

- It will not silently exfiltrate vault contents (no telemetry, no HTTP calls outside the manifests the operator has configured).
- It will not write to the vault outside the inbox-first contract.
- It will not bypass its own audit log.

## Reporting

Until this project has any meaningful user base, security reports come via GitHub issues (`vampyren/agentic-os`) tagged `security`. After a real release, this section will be updated with a private-disclosure path.
