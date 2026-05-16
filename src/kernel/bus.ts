// Typed in-process event bus. Single EventEmitter instance, exposed as a
// module-level singleton. Producers call `bus.emit(envelope)`; consumers
// subscribe via `bus.on(listener)`. The SSE endpoint at /api/events is the
// only browser-facing consumer in Phase 1A.
//
// Bus events are tiny — payloads should not include raw prompts or secrets.

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { BusEvent } from "./types";

export interface BusEmitInput {
  source: string;
  kind: string;
  payload?: unknown;
}

class Bus {
  private ee = new EventEmitter();

  constructor() {
    // Lift the listener cap; SSE clients + audit + future scheduler all listen.
    this.ee.setMaxListeners(50);
  }

  emit(input: BusEmitInput): BusEvent {
    const evt: BusEvent = {
      id: randomUUID(),
      ts: Date.now(),
      source: input.source,
      kind: input.kind,
      payload: input.payload,
    };
    this.ee.emit("event", evt);
    return evt;
  }

  on(listener: (evt: BusEvent) => void): () => void {
    this.ee.on("event", listener);
    return () => this.ee.off("event", listener);
  }
}

// Module-level singleton. Next.js dev mode may re-evaluate modules, so we
// stash on globalThis to survive hot-reload.
const G = globalThis as unknown as { __agenticBus?: Bus };
export const bus: Bus = G.__agenticBus ?? (G.__agenticBus = new Bus());
