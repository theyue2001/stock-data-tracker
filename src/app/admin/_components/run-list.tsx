import { ScrollHint } from "@/components/layout/page";
import type { DatasetRunView, RunView } from "@/lib/health/queries";
import { TRIGGER_LABEL, formatDuration, taipeiTime } from "@/lib/health/format";
import { RunStatusChip } from "./status-chips";

const RUN_COLUMNS = "18px 92px 82px 96px 86px 104px 70px 84px minmax(240px,1fr)";
const HEAD = "text-[10px] font-medium whitespace-nowrap text-[var(--rd-text-muted)]";
const MUTED = "text-[var(--rd-text-muted)]";

function runSummaryText(run: RunView): string | null {
  return run.error ?? run.reason;
}

function DatasetRunTable({ rows }: { rows: DatasetRunView[] }) {
  if (rows.length === 0) return <p className={`px-1 py-2 text-[11px] ${MUTED}`}>這次執行沒有記錄任何資料集。</p>;
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr style={{ borderBottom: "1px solid var(--rd-line)" }}>
          {["資料集", "來源", "交易日", "狀態", "收到 / 寫入 / 預期", "HTTP", "耗時", "錯誤／訊息"].map((h) => (
            <th key={h} className={`px-2 pb-1.5 text-left ${HEAD}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id} className="align-top" style={{ borderBottom: "1px solid var(--rd-line)" }}>
            <td className="px-2 py-1.5 whitespace-nowrap">
              <span className="font-semibold">{d.label}</span>
              <span className={`ml-1.5 font-mono text-[9.5px] ${MUTED}`}>{d.dataset}</span>
            </td>
            <td className="px-2 py-1.5">{d.providerName ?? d.provider ?? <span className={MUTED}>—</span>}</td>
            <td className="tnum px-2 py-1.5 whitespace-nowrap">{d.session ?? "—"}</td>
            <td className="px-2 py-1.5">
              <RunStatusChip status={d.status} />
            </td>
            <td className="tnum px-2 py-1.5 whitespace-nowrap">
              {d.received.toLocaleString("en-US")} / {d.persisted.toLocaleString("en-US")} / {d.expected?.toLocaleString("en-US") ?? "—"}
            </td>
            <td className="tnum px-2 py-1.5">{d.httpStatus ?? <span className={MUTED}>—</span>}</td>
            <td className="tnum px-2 py-1.5 whitespace-nowrap">{formatDuration(d.durationMs)}</td>
            <td className="px-2 py-1.5 font-mono text-[10.5px] break-all text-[rgba(243,242,242,.72)]">{d.error ?? <span className={MUTED}>—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Job runs as expandable rows: the summary line is the run, the body its
 * dataset steps. `<details>` needs no client JavaScript, so the page stays a
 * plain server render.
 */
export function RunList({ runs, empty }: { runs: RunView[]; empty: string }) {
  if (runs.length === 0) return <p className={`rd-card-body text-[11.5px] ${MUTED}`}>{empty}</p>;
  return (
    <div className="rd-card-body">
      <ScrollHint minWidth={1000}>
        <div className="grid items-end gap-x-2 pb-[7px]" style={{ gridTemplateColumns: RUN_COLUMNS, borderBottom: "1px solid var(--rd-rule)" }}>
          <span />
          <span className={HEAD}>開始</span>
          <span className={HEAD}>工作</span>
          <span className={HEAD}>觸發</span>
          <span className={HEAD}>交易日</span>
          <span className={HEAD}>狀態</span>
          <span className={`${HEAD} text-right`}>耗時</span>
          <span className={`${HEAD} text-right`}>資料集</span>
          <span className={HEAD}>原因／錯誤</span>
        </div>
        {runs.map((run) => {
          const text = runSummaryText(run);
          const problems = run.datasets.filter((d) => d.status === "failed" || d.status === "partial").length;
          return (
            <details key={run.id} className="group" style={{ borderBottom: "1px solid var(--rd-line)" }}>
              <summary
                className="rd-tap grid cursor-pointer list-none items-start gap-x-2 py-2 text-[11.5px] [&::-webkit-details-marker]:hidden"
                style={{ gridTemplateColumns: RUN_COLUMNS }}
              >
                <span aria-hidden className={`font-mono transition-transform group-open:rotate-90 ${MUTED}`}>
                  ▸
                </span>
                <span className="tnum whitespace-nowrap">{taipeiTime(run.startedAt)}</span>
                <span className="font-mono text-[11px] font-semibold">{run.job}</span>
                <span className="text-[11px] text-[var(--rd-text-secondary)]">{TRIGGER_LABEL[run.trigger] ?? run.trigger}</span>
                <span className="tnum whitespace-nowrap">{run.session ?? <span className={MUTED}>—</span>}</span>
                <span>
                  <RunStatusChip status={run.status} stalled={run.stalled} />
                </span>
                <span className="tnum text-right whitespace-nowrap">{formatDuration(run.durationMs)}</span>
                <span className="tnum text-right whitespace-nowrap">
                  {run.datasets.length}
                  {problems > 0 && <span className="text-[var(--rd-warn-word)]"> · 異常 {problems}</span>}
                </span>
                <span className={`min-w-0 truncate text-[11px] ${text ? "text-[var(--rd-text-secondary)]" : MUTED}`} title={text ?? undefined}>
                  {text ?? "—"}
                </span>
              </summary>
              <div className="pb-3 pl-[26px]">
                {text && (
                  <p className="mb-2 font-mono text-[10.5px] leading-[1.55] break-all text-[rgba(243,242,242,.72)]">
                    {run.error ? "錯誤：" : "說明："}
                    {text}
                  </p>
                )}
                <DatasetRunTable rows={run.datasets} />
              </div>
            </details>
          );
        })}
      </ScrollHint>
    </div>
  );
}
