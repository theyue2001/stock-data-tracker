"use client";

import { num, pct } from "@/lib/format";
import { directionColor } from "@/lib/radar-ui";
import { DEFAULT_INTRADAY_INTERVAL_SECONDS, describeTaiex, type TaiexKind, type TaiexLabel } from "@/lib/live/labels";
import type { IntradayRow } from "@/lib/live/snapshot";
import { useLiveSnapshot, useServerNow } from "@/components/live/live-store";
import { MockTag } from "@/components/live/mock-tag";

/**
 * The 總覽 TAIEX figure: the one number on the site with an intraday source.
 *
 * Starts from what the server rendered (the newest stored close and intraday
 * row) and takes newer ticks from the /api/live snapshot in place — no page
 * re-render for a tick. Which of the two figures is shown, and what it is
 * called, comes from `describeTaiex`; a close only arrives with a page
 * refresh (its own `dataVersion` change), so the close side is always the
 * server-rendered one and a label can never name a close we do not have.
 *
 * Split into a value and a sub-line component only because KpiStrip takes
 * them as separate slots; both derive the same figure from the same inputs.
 */

export interface TaiexInitial {
  close: { session: string; close: number; change: number; changePct: number; isMock: boolean } | null;
  intraday: IntradayRow | null;
}

interface TaiexFigure {
  label: TaiexLabel;
  last: number;
  change: number;
  changePct: number;
  isMock: boolean;
}

/** Newer of two intraday rows, by session then by write time (ISO strings compare in time order). */
function newer(a: IntradayRow | null, b: IntradayRow | null): IntradayRow | null {
  if (!a || !b) return a ?? b;
  if (a.date !== b.date) return a.date > b.date ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

function useTaiexFigure(initial: TaiexInitial): TaiexFigure | null {
  const snapshot = useLiveSnapshot();
  const nowMs = useServerNow();

  const polled = snapshot?.intraday;
  const intraday = newer(
    initial.intraday,
    polled
      ? {
          date: polled.tickDate,
          last: polled.last,
          change: polled.change,
          changePct: polled.changePct,
          high: polled.high,
          low: polled.low,
          tickAt: polled.tickAt,
          updatedAt: polled.updatedAt,
          isMock: polled.isMock,
        }
      : null,
  );

  const label = describeTaiex(
    {
      closeSession: initial.close?.session ?? null,
      intraday,
      intervalSeconds: snapshot?.intervalSeconds ?? DEFAULT_INTRADAY_INTERVAL_SECONDS,
    },
    nowMs === null ? null : new Date(nowMs),
  );
  if (!label) return null;

  const src = label.source === "intraday" ? intraday : initial.close;
  if (!src) return null;
  return {
    label,
    last: "last" in src ? src.last : src.close,
    change: src.change,
    changePct: src.changePct,
    isMock: src.isMock,
  };
}

const KIND_COLOR: Record<TaiexKind, string> = {
  live: "var(--rd-text)",
  delayed: "var(--rd-warn-word)",
  "last-tick": "var(--rd-warn-word)",
  close: "var(--rd-text-secondary)",
  "previous-close": "var(--rd-text-secondary)",
  "older-close": "var(--rd-text-secondary)",
};

export function LiveTaiexValue({ initial }: { initial: TaiexInitial }) {
  const fig = useTaiexFigure(initial);
  if (!fig) return <>—</>;
  return <span style={{ color: directionColor(fig.changePct) }}>{num(fig.last, 2)}</span>;
}

export function LiveTaiexSub({ initial }: { initial: TaiexInitial }) {
  const fig = useTaiexFigure(initial);
  if (!fig) return <>尚無指數資料</>;
  return (
    <>
      <span className="tnum" style={{ color: directionColor(fig.changePct) }}>
        {fig.change >= 0 ? "▲" : "▼"} {num(Math.abs(fig.change), 2)}（{pct(fig.changePct)}）
      </span>
      <span
        className="tnum mt-0.5 block text-[10px] font-medium"
        style={{ color: fig.label.kind ? KIND_COLOR[fig.label.kind] : "var(--rd-text-secondary)" }}
        title={fig.label.source === "intraday" ? "盤中指數（TWSE MIS 即時行情頁），非收盤價" : "交易所盤後公布的收盤指數"}
      >
        {fig.label.text}
        {fig.isMock && <MockTag />}
      </span>
    </>
  );
}
