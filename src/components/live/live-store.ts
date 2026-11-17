import { useSyncExternalStore } from "react";
import type { LiveSnapshot } from "@/lib/live/snapshot";

/**
 * Browser-side home of the latest /api/live snapshot. One module-level store
 * rather than React context so the refresher (mounted once in the root
 * layout) and the figures that read it (anywhere in a page) need no shared
 * provider wrapped around the server-rendered tree.
 *
 * `nowMs` is the clock every label is computed against: the SERVER's time,
 * carried forward by the offset measured on the last successful poll, so a
 * visitor whose computer clock is minutes off still sees 即時 / 延遲 decided
 * by the same clock the exchange data is stamped with. It stays null until
 * the first poll answers — until then figures show only labels that are true
 * at any time — and then ticks every few seconds so a tick that stops
 * arriving degrades from 即時 to 延遲 even if polls start failing.
 */

export type LiveStatus = "idle" | "ok" | "error";

interface LiveState {
  snapshot: LiveSnapshot | null;
  status: LiveStatus;
  /** server clock minus client clock, from the last successful poll */
  offsetMs: number;
  nowMs: number | null;
}

const CLOCK_TICK_MS = 5_000;

let state: LiveState = { snapshot: null, status: "idle", offsetMs: 0, nowMs: null };
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;

function emit(next: LiveState) {
  state = next;
  for (const fn of listeners) fn();
}

function tick() {
  if (state.nowMs === null || document.visibilityState !== "visible") return;
  emit({ ...state, nowMs: Date.now() + state.offsetMs });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  ticker ??= setInterval(tick, CLOCK_TICK_MS);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}

/**
 * Record a successful poll. `ageSeconds` is the response's `Age` header: a
 * CDN-cached snapshot was generated that long before it reached us, and the
 * offset must not inherit that lag.
 */
export function publishSnapshot(snapshot: LiveSnapshot, receivedAtMs: number, ageSeconds: number) {
  const serverNowMs = Date.parse(snapshot.generatedAt) + Math.max(0, ageSeconds) * 1000;
  const offsetMs = Number.isFinite(serverNowMs) ? serverNowMs - receivedAtMs : 0;
  emit({ snapshot, status: "ok", offsetMs, nowMs: receivedAtMs + offsetMs });
}

/** Record a failed poll. Keeps the last snapshot; starts the clock (on the local time) if none ever arrived. */
export function publishPollError() {
  if (state.status === "error" && state.nowMs !== null) return;
  emit({ ...state, status: "error", nowMs: state.nowMs ?? Date.now() + state.offsetMs });
}

const SERVER_NULL = () => null;

export function useLiveSnapshot(): LiveSnapshot | null {
  return useSyncExternalStore(subscribe, () => state.snapshot, SERVER_NULL);
}

/** Server-adjusted epoch ms, or null before the first poll (and always during server rendering). */
export function useServerNow(): number | null {
  return useSyncExternalStore(subscribe, () => state.nowMs, SERVER_NULL);
}
