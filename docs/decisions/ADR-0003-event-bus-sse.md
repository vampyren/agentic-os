# ADR-0003 — In-process event bus with single SSE endpoint

**Status:** Accepted
**Date:** 2026-05-16

## Context

Julian's v0.1 uses REST polling for live UI updates:

- `Vitals` polls `/api/vitals` on a fixed interval.
- `ActivityStream` polls `/api/activity` (which re-reads agent log files each call).
- Each agent panel's status comes from its own polled endpoint.

This works for three agents and a single operator, but:

- Polling intervals are a compromise between "feels live" and "doesn't hammer the CPU." The current intervals are educated guesses.
- New panels added in the UI invent their own polling cadence; consistency suffers.
- Streaming chat already uses a one-off SSE-like response (`/api/claude/chat`). Mixing two patterns for "real-time stuff" is unnecessary.
- The scheduler (Phase 2) will produce events with no good way to push them to the UI under the polling model.

## Decision

A single in-process event bus (`EventEmitter` singleton in `src/lib/bus.ts`) carries every real-time event in the system. Events have a typed envelope:

```typescript
interface BusEvent {
  id: string;
  ts: number;
  source: string;           // agent name | "system" | "vault" | "scheduler"
  kind: string;             // e.g. "agent.health", "vault.write", "chat.delta", "mission.complete"
  payload: unknown;         // shape per kind, typed via discriminated union
}
```

One SSE endpoint at `/api/events` fans the bus out to all connected browser clients. The UI subscribes once at mount via an `EventBusProvider` React context; every component that needs live data filters from that single stream.

Producers (transports, vault writer, scheduler, vitals probe loop) call `bus.emit(event)`. There is no other way to publish real-time data to the UI.

REST endpoints remain for **one-shot** operations: send a chat prompt, write a goal, search the vault. Long-running responses (streaming chat tokens, mission progress) go on the bus.

## Consequences

**Positive**

- One subscription, one connection per browser tab. Lower socket overhead than N parallel polls.
- New event kinds added by Phase 2/3 features (scheduler missions, MCP tool calls, agent-to-agent workflows) plug into the same channel.
- Server-side filtering is easy if needed later (per-tab subscriptions filtered by event kind).
- The audit log can subscribe to the bus instead of being instrumented everywhere — fewer places to forget logging.

**Negative**

- SSE doesn't reconnect cleanly across long network blips. For Phase 1 (localhost only) this is a non-issue. For Phase 3 (remote access), the client needs proper reconnect logic + last-event-id replay. The bus would need a short ring buffer to back this; out of scope for now.
- An unbounded fast event source (e.g., a chatty subprocess streaming gigabytes of stdout) could overwhelm a browser. Mitigation: per-source rate cap in the bus → SSE bridge, configurable per agent.

**Neutral**

- The bus is in-process. Multi-process architectures (separating the kernel from the Next.js server) would need a real broker (Redis/NATS). Not a Phase 1 concern.

## Alternatives considered

- **WebSocket instead of SSE.** SSE is one-directional (server → client), simpler, works through proxies, has built-in reconnect at the browser level. We don't need bidirectional. SSE wins on simplicity.
- **Keep REST polling, just standardize the cadence.** Doesn't address Phase 2 scheduler events at all. Pushes the same problem down the road.
- **Drop the bus, have each transport expose its own SSE endpoint.** Multiplies endpoints, complicates the UI, makes it harder to add cross-cutting concerns (audit, rate-limiting, recording).

## References

- [`docs/ARCHITECTURE.md#3-event-bus--sse`](../ARCHITECTURE.md#3-event-bus--sse).
