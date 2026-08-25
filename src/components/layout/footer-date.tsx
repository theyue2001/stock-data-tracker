"use client";

import { useSyncExternalStore } from "react";

/**
 * Today's date in the sidebar footer.
 *
 * Read on the client on purpose: taking the clock on the server would make the
 * root layout un-prerenderable (Cache Components rejects `new Date()` inside a
 * prerender), and that would cost every route its static shell — with it, the
 * instant sidebar navigation the shell pays for. The date is also genuinely
 * per-viewer, so the client is where it belongs.
 *
 * useSyncExternalStore rather than an effect: it renders the server snapshot
 * (null) during prerender and hydration, then the client snapshot, with no
 * hydration mismatch and no cascading render from a setState.
 */

/** The clock is only read once per mount, so there is nothing to subscribe to. */
const subscribe = () => () => {};

function todayLabel(): string {
  const now = new Date();
  const date = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const day = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return `${date} ${day}`;
}

export function FooterDate() {
  const label = useSyncExternalStore(subscribe, todayLabel, () => null);

  return (
    <>
      {/* Non-breaking space holds the line's height before the client snapshot
          lands, so the footer never shifts when the date appears. */}
      {label ?? " "}
      <br />
      收盤資料 · 20:00 更新
    </>
  );
}
