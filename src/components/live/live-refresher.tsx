"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { MarketPhase } from "@/lib/market-session";
import type { LiveSnapshot } from "@/lib/live/snapshot";
import { publishPollError, publishSnapshot } from "@/components/live/live-store";

/**
 * Keeps an open tab current without a reload. Mounted exactly once, in the
 * root layout, and the only thing in the app that polls.
 *
 * - Polls GET /api/live (one small DB-backed snapshot, cached server-side and
 *   at the CDN — never an exchange API) on a cadence set by the market phase.
 * - Only while the tab is visible; a tab coming back to the foreground polls
 *   at once. In-flight requests are aborted when superseded or hidden.
 * - Failures back off exponentially from the phase cadence.
 * - The intraday TAIEX tick is applied in place through live-store; nothing
 *   is re-rendered on the server for it.
 * - When the snapshot's `dataVersion` differs from the one this page was
 *   rendered with, after-hours data changed: `router.refresh()` re-fetches
 *   the Server Component payload and merges it without losing scroll or
 *   client state.
 *
 * The first refresh for a new version is always followed by one more on the
 * next poll. Under stale-while-revalidate (`revalidateTag(tag, "max")`)
 * every cached read regenerates on its own schedule, so one refresh can come
 * back with a fresh data stamp over still-stale figures — observed: the
 * stamp matched, the TAIEX close did not, and nothing would have refreshed
 * again. By the next poll every read the first refresh touched has
 * regenerated. Capped per version, because a job that wrote rows without
 * expiring the page cache would otherwise trigger a refresh every poll that
 * re-renders the same cached page.
 */

const POLL_MS: Record<MarketPhase, number> = {
  open: 15_000,
  "pre-open": 60_000,
  "post-close": 60_000,
  "closed-day": 5 * 60_000,
};
/** Cadence before the first snapshot has told us the phase. */
const UNKNOWN_PHASE_MS = 15_000;
const MAX_BACKOFF_MS = 10 * 60_000;
/** First refresh, the confirming one, and one retry if the page is still behind after both. */
const MAX_REFRESHES_PER_VERSION = 3;

export function LiveRefresher({ renderedVersion }: { renderedVersion: string }) {
  const router = useRouter();
  const renderedRef = useRef(renderedVersion);

  useEffect(() => {
    renderedRef.current = renderedVersion;
  }, [renderedVersion]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: AbortController | null = null;
    let failures = 0;
    let phase: MarketPhase | null = null;
    const refreshes = new Map<string, number>();

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(poll, ms);
    };

    async function poll() {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;

      inflight?.abort();
      const controller = new AbortController();
      inflight = controller;

      try {
        const res = await fetch("/api/live", { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error(`/api/live answered ${res.status}`);
        const snapshot = (await res.json()) as LiveSnapshot;
        publishSnapshot(snapshot, Date.now(), Number(res.headers.get("age")) || 0);
        failures = 0;
        phase = snapshot.phase;

        const n = refreshes.get(snapshot.dataVersion) ?? 0;
        const behind = snapshot.dataVersion !== renderedRef.current;
        // n === 1: the confirming refresh, sent even if the stamp now matches.
        if (n < MAX_REFRESHES_PER_VERSION && (behind || n === 1)) {
          refreshes.set(snapshot.dataVersion, n + 1);
          router.refresh();
        }
        schedule(POLL_MS[snapshot.phase]);
      } catch {
        // Aborted: whoever aborted (a newer poll, the tab hiding, unmount) owns the next step.
        if (controller.signal.aborted) return;
        failures += 1;
        publishPollError();
        schedule(Math.min((phase ? POLL_MS[phase] : UNKNOWN_PHASE_MS) * 2 ** failures, MAX_BACKOFF_MS));
      } finally {
        if (inflight === controller) inflight = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void poll();
      } else {
        clearTimeout(timer);
        inflight?.abort();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(timer);
      inflight?.abort();
    };
  }, [router]);

  return null;
}
