import { ScrollHint } from "@/components/layout/page";
import type { DatasetRow } from "@/lib/health/queries";
import { RUN_STATUS_LABEL, formatAge, formatDuration, taipeiTime, urlHost } from "@/lib/health/format";
import { HealthChip } from "./status-chips";

const TH = "px-2 pb-[7px] text-left text-[10px] font-medium whitespace-nowrap text-[var(--rd-text-muted)]";
const TD = "px-2 py-2 align-top";
const SUB = "mt-0.5 text-[10px] leading-[1.45] text-[var(--rd-text-muted)]";

function freshness(row: DatasetRow): { text: string; sub?: string } {
  const h = row.health;
  if (row.kind === "session") {
    if (h.sessionsBehind === null) return { text: "—", sub: "無成功紀錄" };
    return h.sessionsBehind === 0 ? { text: "最新" } : { text: `落後 ${h.sessionsBehind} 日`, sub: `應涵蓋 ${h.expectedSession}` };
  }
  if (row.kind === "intraday") return h.ageSeconds === null ? { text: "—" } : { text: formatAge(h.ageSeconds), sub: "報價時間至今" };
  return h.ageSeconds === null ? { text: "—", sub: "無成功紀錄" } : { text: formatAge(h.ageSeconds), sub: "距上次成功" };
}

function counts(row: DatasetRow) {
  const a = row.latest;
  if (!a) return <span className="text-[var(--rd-text-muted)]">—</span>;
  return (
    <>
      <span className="tnum">
        {a.received.toLocaleString("en-US")} / {a.persisted.toLocaleString("en-US")}
      </span>
      <div className={SUB}>{a.expected != null ? `預期 ${a.expected.toLocaleString("en-US")}` : "收到 / 寫入"}</div>
    </>
  );
}

/**
 * One row per (dataset, provider). Errors get a full-width line under their
 * row rather than a column: they are long, and a 240px column would wrap a
 * URL into a dozen lines.
 */
export function DatasetTable({ rows }: { rows: DatasetRow[] }) {
  return (
    <ScrollHint minWidth={1120}>
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--rd-rule)" }}>
            <th className={TH}>資料集</th>
            <th className={TH}>狀態</th>
            <th className={TH}>來源</th>
            <th className={TH}>交易日</th>
            <th className={TH}>最近嘗試</th>
            <th className={TH}>最近成功</th>
            <th className={`${TH} text-right`}>筆數</th>
            <th className={`${TH} text-right`}>耗時</th>
            <th className={TH}>新鮮度</th>
            <th className={`${TH} text-right`}>HTTP</th>
          </tr>
        </thead>
        {rows.map((row) => {
          const a = row.latest;
          const fresh = freshness(row);
          const message = a?.error ?? null;
          return (
            <tbody key={row.id} style={{ borderBottom: "1px solid var(--rd-line)" }}>
              <tr>
                <td className={`${TD} w-[150px]`}>
                  <div className="text-[12px] font-bold text-[var(--rd-text)]">{row.label}</div>
                  <div className="mt-0.5 font-mono text-[9.5px] text-[var(--rd-text-muted)]">{row.dataset}</div>
                </td>
                <td className={`${TD} w-[170px]`}>
                  <HealthChip status={row.health.status} />
                  <div className={SUB}>{row.health.reason}</div>
                </td>
                <td className={`${TD} w-[170px]`}>
                  {row.provider ? (
                    <>
                      <div className="text-[11.5px] text-[var(--rd-text)]">{row.providerName ?? row.provider}</div>
                      <div className="mt-0.5 font-mono text-[9.5px] break-all text-[var(--rd-text-muted)]">
                        {row.providerUrl ? (
                          <a href={row.providerUrl} target="_blank" rel="noreferrer">
                            {urlHost(row.providerUrl)}
                          </a>
                        ) : row.providerName ? (
                          // The name line above shows the display name; keep the key findable.
                          row.provider
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <span className="text-[var(--rd-text-muted)]">{row.attempted ? "未標示" : "—"}</span>
                  )}
                </td>
                <td className={`${TD} tnum whitespace-nowrap`}>{a?.session ?? "—"}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  {a ? (
                    <>
                      <span className="tnum">{taipeiTime(a.startedAt)}</span>
                      <div className={SUB}>{RUN_STATUS_LABEL[a.status] ?? a.status}</div>
                    </>
                  ) : (
                    <span className="text-[var(--rd-text-muted)]">{row.attempted ? "—" : "無紀錄"}</span>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  {row.latestSuccess ? (
                    <>
                      <span className="tnum">{taipeiTime(row.latestSuccess.finishedAt)}</span>
                      <div className={SUB}>{row.latestSuccess.session ? `交易日 ${row.latestSuccess.session}` : "無交易日"}</div>
                    </>
                  ) : (
                    <span className="text-[var(--rd-text-muted)]">—</span>
                  )}
                </td>
                <td className={`${TD} text-right whitespace-nowrap`}>{counts(row)}</td>
                <td className={`${TD} tnum text-right whitespace-nowrap`}>{formatDuration(a?.durationMs)}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="tnum">{fresh.text}</span>
                  {fresh.sub && <div className={SUB}>{fresh.sub}</div>}
                </td>
                <td className={`${TD} tnum text-right`}>{a?.httpStatus ?? <span className="text-[var(--rd-text-muted)]">—</span>}</td>
              </tr>
              {message && (
                <tr>
                  <td colSpan={10} className="px-2 pb-2.5">
                    <div
                      className="flex gap-2 px-2.5 py-1.5 font-mono text-[10.5px] leading-[1.55] break-all text-[rgba(243,242,242,.72)]"
                      style={{
                        background: "rgba(243,242,242,.035)",
                        borderLeft: `2px solid ${a?.status === "failed" ? "var(--rd-text)" : "var(--rd-line)"}`,
                      }}
                    >
                      <span className="shrink-0 font-sans font-semibold text-[var(--rd-text-secondary)]">
                        {a?.status === "failed" ? "錯誤" : "訊息"}
                      </span>
                      <span className="min-w-0">
                        {a?.httpStatus != null && `HTTP ${a.httpStatus} · `}
                        {message}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </ScrollHint>
  );
}
