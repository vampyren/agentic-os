"use client";

// React hook around chatStore — subscribes to a given agent's session and
// re-renders the component whenever it changes.

import { useEffect, useState } from "react";
import { chatStore, type ChatSession } from "./chatStore";

export function useChatSession(agent: string): ChatSession {
  // Use the rev counter as the dependency so React schedules a re-render
  // when the store mutates.
  const [, force] = useState(0);

  useEffect(() => {
    return chatStore.subscribe(agent, () => force((x) => x + 1));
  }, [agent]);

  return chatStore.get(agent);
}
