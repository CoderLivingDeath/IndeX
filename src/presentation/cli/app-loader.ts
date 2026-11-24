// ---------------------------------------------------------------------------
// Lazy app loader — imports the full application only when first called
// ---------------------------------------------------------------------------

import type { AppUseCases } from "../../index";

let appPromise: Promise<AppUseCases> | null = null;

/**
 * Load (and cache) the full application.
 *
 * First call imports all native modules (LanceDB, chokidar, ast-grep, ~5s).
 * Subsequent calls return the cached instance instantly.
 */
export async function loadApp(): Promise<AppUseCases> {
  if (!appPromise) {
    appPromise = (async () => {
      const { createApp } = await import("../../index");
      return createApp({ pretty: true });
    })();
  }
  return appPromise;
}
