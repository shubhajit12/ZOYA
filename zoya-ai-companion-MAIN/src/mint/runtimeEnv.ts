/**
 * Runtime environment helpers (shared, side-effect free).
 *
 * `import.meta.env.DEV` is statically replaced by Vite in browser builds,
 * but `import.meta.env` is undefined under plain Node/tsx runners and some
 * test harnesses. Direct access would throw there, so all DEV-gated code
 * must go through `isDevBuild()`.
 */
export function isDevBuild(): boolean {
  try {
    const env = (import.meta as unknown as { env?: { DEV?: unknown } }).env;
    return env?.DEV === true;
  } catch {
    return false;
  }
}
