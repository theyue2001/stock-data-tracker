"use client";

import { useState, useTransition } from "react";
import { toggleWatchlistItem } from "@/app/watchlist/actions";
import type { WatchlistItemType } from "@/lib/types";

/** ☆ 35%-white → ★ accent red. Click always stops propagation so it can sit
 *  inside a clickable row/card without triggering navigation (design_handoff
 *  README → "Watch star"). Optimistic: flips immediately, then reconciles
 *  with the server action (DB-backed watchlist, not localStorage — see
 *  src/app/watchlist/actions.ts). */
export function WatchStar({
  itemType,
  targetId,
  initialActive,
  size = 13,
  onChange,
}: {
  itemType: WatchlistItemType;
  targetId: string;
  initialActive: boolean;
  size?: number;
  /** Notified with the new state right after an optimistic toggle — lets a
   *  parent list (e.g. "★ 僅看追蹤") keep its own watched-set in sync without
   *  waiting on a server round-trip. */
  onChange?: (active: boolean) => void;
}) {
  const [active, setActive] = useState(initialActive);
  const [, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? "移除追蹤" : "加入追蹤"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setActive((v) => {
          onChange?.(!v);
          return !v;
        });
        startTransition(() => {
          toggleWatchlistItem(itemType, targetId);
        });
      }}
      className="inline-flex shrink-0 cursor-pointer items-center justify-center leading-none"
      style={{ fontSize: size, color: active ? "var(--rd-accent)" : "rgba(243,242,242,.35)" }}
    >
      {active ? "★" : "☆"}
    </button>
  );
}
