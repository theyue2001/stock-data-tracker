import { getDataStamp } from "@/lib/queries";
import { mmddWeekday, taipeiStamp } from "@/lib/live/labels";
import { MockTag } from "@/components/live/mock-tag";

/**
 * Sidebar footer: which session the dashboard's after-hours data is from,
 * and when it last landed — both read from the database, in Asia/Taipei.
 *
 * Used to print the visitor's own calendar date and a hard-coded
 * 「收盤資料 · 20:00 更新」, neither of which said anything about the data
 * (no job runs at 20:00). Both values come from the cached data stamp, which
 * is clock-free, so the layout keeps its prerendered shell; the formatting
 * pins the timezone so a UTC server prints the same time as a Taipei one.
 */
export async function FooterDate() {
  const stamp = await getDataStamp();
  return (
    <>
      {stamp.session ? `收盤資料 ${mmddWeekday(stamp.session)}` : "尚無收盤資料"}
      {stamp.isMock && <MockTag />}
      <br />
      {stamp.lastUpdatedAt ? `更新 ${taipeiStamp(stamp.lastUpdatedAt)}` : "更新時間未知"}
    </>
  );
}

/** Holds the footer's two lines while the stamp streams in, so nothing shifts. */
export function FooterDateFallback() {
  return (
    <>
      {" "}
      <br />
      {" "}
    </>
  );
}
