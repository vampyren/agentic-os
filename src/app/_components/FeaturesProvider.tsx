"use client";

// Features context — registry-driven shell (Phase 1C — M2).
//
// `Shell` (a server component) resolves the feature registry once per
// request and projects it to the UI-safe shape; this provider carries
// that `UiSafeFeature[]` to the client shell components (Sidebar,
// CommandPalette, Mission Control cards) so they render the registry
// without each doing its own `/api/features` fetch — no loading flash,
// no extra round-trip on navigation.
//
// Only the TYPE of UiSafeFeature is imported (erased at compile time),
// so this client module pulls no kernel/server code into the bundle.

import { createContext, useContext, type ReactNode } from "react";
import type { UiSafeFeature } from "@/kernel/features/projection";

const FeaturesContext = createContext<readonly UiSafeFeature[]>([]);

export function FeaturesProvider({
  value,
  children,
}: {
  value: readonly UiSafeFeature[];
  children: ReactNode;
}) {
  return (
    <FeaturesContext.Provider value={value}>
      {children}
    </FeaturesContext.Provider>
  );
}

/** The UI-safe feature list resolved for this request. */
export function useFeatures(): readonly UiSafeFeature[] {
  return useContext(FeaturesContext);
}
