"use client";

import { freshness, staleText } from "@/lib/live/labels";
import { useLiveSnapshot, useServerNow } from "@/components/live/live-store";

/**
 * The one site-wide "this data is behind" warning. Shown only when the
 * newest stored after-hours session is older than the one that should
 * already be out (expectedLatestSession), and says by how many trading days.
 *
 * Decided in the browser against the server-adjusted clock rather than at
 * render time, so the pages it sits above stay prerendered. Uses the polled
 * snapshot's session once there is one (that is the database right now);
 * before that, the session the page was rendered with.
 */
export function StaleBanner({ renderedSession }: { renderedSession: string | null }) {
  const snapshot = useLiveSnapshot();
  const nowMs = useServerNow();
  if (nowMs === null) return null;

  const text = staleText(freshness(snapshot ? snapshot.close.session : renderedSession, new Date(nowMs)));
  if (!text) return null;

  return (
    <div className="px-4 pt-3 sm:px-6">
      <div
        role="status"
        className="rd-card px-3 py-2 text-[11px] leading-[1.5] font-medium"
        style={{ borderColor: "rgba(230,178,58,.45)", background: "rgba(230,178,58,.06)", color: "var(--rd-warn-word)" }}
      >
        {text}
      </div>
    </div>
  );
}
