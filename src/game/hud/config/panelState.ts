import type { InjectionKey, Ref } from 'vue';
import type { MatchConfigSource } from './MatchConfigSource';

/**
 * What every tab injects: the source, and the counter that makes a `computed`
 * over it re-run.
 *
 * The counter exists because the source is deliberately **not** reactive. On
 * the in-game side it wraps `MatchDirector`, which `hudInteractions.ts` holds
 * in `markRaw` on purpose: a proxied director hands back a proxied
 * `objectManager`, proxied units and proxied p5 vectors — the whole game graph
 * — on every read, which is a real per-frame cost to solve a problem that only
 * exists while this panel is open. Wrapping the source instead would put the
 * proxy one level higher and change nothing.
 *
 * The invariant that keeps it honest is one line: **every mutating call a tab
 * makes is followed by `invalidate()`**.
 */
export interface ConfigPanelState {
  source: MatchConfigSource;
  /** Read for the dependency, never for the value. */
  version: Ref<number>;
  invalidate(): void;
}

export const CONFIG_PANEL = Symbol('matchConfigPanel') as InjectionKey<ConfigPanelState>;
