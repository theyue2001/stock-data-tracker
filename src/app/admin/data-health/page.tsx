import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { PageHeader, PageShell } from "@/components/layout/page";
import { KpiStrip } from "@/components/radar/kpi-strip";
import { Panel } from "@/components/radar/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { PHASE_LABEL, formatAge, taipeiTime } from "@/lib/health/format";
import { FAILURE_HISTORY_DAYS, RECENT_RUNS_LIMIT, getDataHealthReport, type DataHealthReport } from "@/lib/health/queries";
import { clockLabel, DEFAULT_SESSION_DEADLINE_MIN } from "@/lib/health/status";
import { CLOSE_PUBLISHED_MIN } from "@/lib/market-session";
import { requireAdminPage } from "../_lib/require-admin";
import { DatasetTable } from "../_components/dataset-table";
import { RunList } from "../_components/run-list";
import { HealthChip, Notice } from "../_components/status-chips";

export const metadata = { title: "資料健康 · 台股產業雷達" };

/**
 * Admin: is every dataset current, and if not, why. Read-only — nothing here
 * runs a job or writes a row.
 *
 * The header is static; everything that reads the database renders at request
 * time inside the Suspense boundary (`connection()`, no "use cache"), so the
 * page always shows the database as it is now.
 */
export default function DataHealthPage() {
  return (
    <PageShell>
      <PageHeader title="資料健康" note="ADMIN · 唯讀" subtitle="每個資料來源是否為最新、沒更新的原因。此頁即時讀取資料庫，不會觸發任何工作。" />
      <Suspense fallback={<ReportSkeleton />}>
        <DataHealthReportView />
      </Suspense>
    </PageShell>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-3 sm:gap-4" aria-busy>
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[74px]" />
        ))}
      </div>
      <Skeleton className="h-[420px]" />
    </div>
  );
}

async function DataHealthReportView() {
  await connection();
  const mode = await requireAdminPage("/admin/data-health");
  const report = await getDataHealthReport(new Date());

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[10.5px] text-[var(--rd-text-muted)]">
        <span className="font-mono">判斷時間 {taipeiTime(report.checkedAt, { full: true })}（台北）</span>
        {mode === "token" && (
          <form method="post" action="/api/admin/logout" className="ml-auto">
            <button
              type="submit"
              className="cursor-pointer px-2.5 py-1 text-[11px] font-medium text-[var(--rd-text-secondary)] hover:bg-[var(--rd-hover)] hover:text-[var(--rd-text)]"
              style={{ border: "1px solid var(--rd-line)" }}
            >
              登出
            </button>
          </form>
        )}
      </div>

      {mode === "open-dev" && (
        <Notice tone="warn" title="未設定 ADMIN_TOKEN">
          開發環境允許不登入直接瀏覽。部署到正式環境前必須設定，否則整個管理區一律回應 503。
        </Notice>
      )}
      <CalendarNotice report={report} />

      <SummaryStrip report={report} />

      {report.hasRuns ? (
        <Panel
          title="資料集狀態"
          kicker="DATASETS"
          note={`收盤類 ${clockLabel(DEFAULT_SESSION_DEADLINE_MIN)}、法人與其衍生 ${clockLabel(report.config.flowDeadlineMin)} 後仍未到算延遲`}
        >
          <DatasetTable rows={report.datasets} />
        </Panel>
      ) : (
        <Panel title="資料集狀態" kicker="DATASETS">
          <p className="text-[12px] font-semibold">尚無執行紀錄</p>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-[var(--rd-text-secondary)]">
            資料庫裡還沒有任何 JobRun。排程或手動執行一次每日 pipeline、盤中輪詢或來源檢查後，這裡會逐一列出每個資料集的狀態。
          </p>
        </Panel>
      )}

      <IntradayPanel report={report} />

      {report.hasRuns && (
        <>
          <Panel
            title="失敗紀錄"
            kicker={`LAST ${FAILURE_HISTORY_DAYS} DAYS`}
            flush
            note={`${FAILURE_HISTORY_DAYS} 日內 ${report.failureCount} 筆失敗、部分成功或未正常結束${report.failureCount > report.failures.length ? `，列出最近 ${report.failures.length} 筆` : ""}`}
          >
            <RunList runs={report.failures} empty={`${FAILURE_HISTORY_DAYS} 日內沒有失敗或部分成功的執行。`} />
          </Panel>
          <Panel title="最近執行紀錄" kicker="JOB RUNS" flush note={`最近 ${RECENT_RUNS_LIMIT} 筆 · 盤中輪詢見上方盤中指數 · 點列展開資料集`}>
            <RunList runs={report.recentRuns} empty="除盤中輪詢外尚無執行紀錄。" />
          </Panel>
        </>
      )}
    </div>
  );
}

function CalendarNotice({ report }: { report: DataHealthReport }) {
  const c = report.calendar;
  if (!c.covered) {
    return (
      <Notice tone="fail" title={`交易日曆缺 ${c.year} 年`}>
        src/lib/market-session.ts 沒有 {c.year} 年的 TWSE 休市日，目前把每個週一到週五都當交易日推算，國定假日會被誤判為延遲。請補上當年休市日表。
      </Notice>
    );
  }
  if (c.december && !c.nextCovered) {
    return (
      <Notice tone="warn" title={`交易日曆缺 ${c.nextYear} 年`}>
        TWSE 每年 12 月公布隔年休市日；請在跨年前把 {c.nextYear} 年加進 src/lib/market-session.ts。
      </Notice>
    );
  }
  return null;
}

function SummaryStrip({ report }: { report: DataHealthReport }) {
  const behind = report.overall.behindTradingDays;
  const pub = report.publicVerdict;
  return (
    <KpiStrip
      cells={[
        {
          label: "整體狀態",
          value: <HealthChip status={report.overall.status} large />,
          // No accent `emphasis` here: on this site that tint means 漲 / inflow.
          sub: `對外 /api/health 回應 ${pub.ok ? "200" : "503"}（只計核心資料集）`,
        },
        {
          label: "最新已存交易日",
          value: report.latestSession ?? "—",
          sub: behind === null ? "資料庫沒有收盤資料" : behind === 0 ? "已是最新" : `落後 ${behind} 個交易日`,
        },
        {
          label: "預期最新交易日",
          value: report.overall.expectedSession,
          sub: `交易日 ${clockLabel(CLOSE_PUBLISHED_MIN)} 後起算當日`,
        },
        {
          label: "盤勢階段",
          value: PHASE_LABEL[report.phase],
          sub: `台北 ${taipeiTime(report.checkedAt).split(" ")[1]}`,
        },
      ]}
    />
  );
}

function IntradayPanel({ report }: { report: DataHealthReport }) {
  const { tick, health, today, staleAfterSeconds } = report.intraday;
  const todayTotal = Object.values(today).reduce((s, n) => s + n, 0);
  const cells: { label: string; value: ReactNode; sub?: string }[] = [
    { label: "狀態", value: <HealthChip status={health.status} />, sub: health.reason },
    { label: "交易日", value: tick?.date ?? "—" },
    { label: "最新報價時間", value: tick?.tickAt ?? "—", sub: "交易所回報時間" },
    { label: "寫入時間", value: tick ? taipeiTime(tick.updatedAt, { seconds: true }) : "—" },
    { label: "資料年齡", value: formatAge(health.ageSeconds), sub: `盤中超過 ${formatAge(staleAfterSeconds)} 未更新算延遲` },
    {
      label: "今日輪詢",
      value: todayTotal === 0 ? "—" : `${today.success ?? 0} / ${todayTotal}`,
      sub: todayTotal === 0 ? "今日尚無紀錄" : `成功 / 全部 · 失敗 ${today.failed ?? 0}`,
    },
  ];
  return (
    <Panel title="盤中指數" kicker="INTRADAY" note="最新一筆 IntradayIndex（TAIEX）">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <div className="text-[10px] font-medium text-[var(--rd-text-secondary)]">{c.label}</div>
            <div className="tnum mt-1 text-[14px] font-bold">{c.value}</div>
            {c.sub && <div className="mt-0.5 text-[10px] leading-[1.45] text-[var(--rd-text-muted)]">{c.sub}</div>}
          </div>
        ))}
      </div>
    </Panel>
  );
}
