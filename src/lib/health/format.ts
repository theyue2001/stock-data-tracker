import type { MarketPhase } from "../market-session";

/** Display helpers for the data-health page. Every time is shown in Taipei,
 *  whatever timezone the server renders in. */

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(d: Date): Record<string, string> {
  return Object.fromEntries(PARTS.formatToParts(d).map((p) => [p.type, p.value]));
}

/** "11/17 16:05" — or "2026-11-17 16:05:12" with `full`. */
export function taipeiTime(d: Date | null | undefined, opts: { full?: boolean; seconds?: boolean } = {}): string {
  if (!d) return "—";
  const p = parts(d);
  const time = opts.full || opts.seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  return opts.full ? `${p.year}-${p.month}-${p.day} ${time}` : `${p.month}/${p.day} ${time}`;
}

/** "45 秒" / "12 分鐘" / "3.5 小時" / "2 天". */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 120) return `${Math.round(seconds)} 秒`;
  const minutes = seconds / 60;
  if (minutes < 120) return `${Math.round(minutes)} 分鐘`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} 小時`;
  return `${Math.round(hours / 24)} 天`;
}

/** "850 ms" / "2.3 秒" / "4 分 05 秒". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)} 分 ${String(whole % 60).padStart(2, "0")} 秒`;
}

export const PHASE_LABEL: Record<MarketPhase, string> = {
  "pre-open": "盤前",
  open: "盤中",
  "post-close": "盤後",
  "closed-day": "休市日",
};

/** JobRun / DatasetRun status words (the raw log statuses, not health verdicts). */
export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "執行中",
  success: "成功",
  partial: "部分成功",
  failed: "失敗",
  skipped: "略過",
  waiting: "等待發布",
};

export const TRIGGER_LABEL: Record<string, string> = {
  "vercel-cron": "Vercel Cron",
  "external-cron": "外部排程",
  "github-actions": "GitHub Actions",
  route: "API 呼叫",
  cli: "命令列",
  scheduler: "本機排程",
};

/** Host of a source URL for a compact link label; the raw string if it does not parse. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
