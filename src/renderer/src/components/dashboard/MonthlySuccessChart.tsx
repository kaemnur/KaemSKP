import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type MonthData = {
  month: number;
  label: string;
  successCount: number;
  totalCount: number;
  successRate: number;
};

type MonthlySuccessResponse = {
  success: true;
  year: number;
  months: MonthData[];
  summary: {
    totalSuccess: number;
    bestMonth: MonthData | null;
    averagePerMonth: number;
  };
};

type ChartPoint = MonthData & {
  x: number;
  y: number;
  xPercent: number;
  yPercent: number;
  labelPercent: number;
};

type LoadState = "loading" | "ready" | "error";

const CHART_WIDTH = 1200;
const CHART_HEIGHT = 380;
const CHART_LEFT = 34;
const CHART_RIGHT = 30;
const CHART_TOP = 22;
const CHART_BASELINE = 330;

export function MonthlySuccessChart({ year, className }: { year: number; className?: string }): JSX.Element {
  const [data, setData] = useState<MonthlySuccessResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("Grafik belum bisa dimuat.");

  async function load(): Promise<void> {
    setState("loading");
    try {
      const result = (await api.getMonthlySuccess(year)) as MonthlySuccessResponse;
      setData(result);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grafik belum bisa dimuat.");
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, [year]);

  const maxValue = useMemo(() => Math.max(1, ...(data?.months.map((month) => month.successCount) ?? [0])), [data]);
  const hasSuccess = (data?.summary.totalSuccess ?? 0) > 0;
  const chart = useMemo(() => buildLineChart(data?.months ?? [], maxValue), [data, maxValue]);
  const chartSummary = data ? buildChartSummary(data) : "";

  return (
    <Card className={cn("dashboard-chart-card", className)}>
      <CardHeader className="px-4 py-3 sm:px-5">
        <CardTitle>Pengisian SKP Berhasil per Bulan</CardTitle>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Jumlah log harian yang berhasil dikirim atau ditandai terkirim setiap bulan.
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-2.5 pt-2.5 sm:p-3 sm:pt-3">
        {state === "loading" && <ChartSkeleton />}
        {state === "error" && (
          <ErrorState
            title="Grafik belum berhasil dimuat"
            message={error}
            onRetry={() => {
              void load();
            }}
          />
        )}
        {state === "ready" && data && !hasSuccess && (
          <EmptyState
            title="Belum ada data berhasil."
            description="Grafik akan muncul setelah log berhasil dikirim ke SKP."
            icon={<BarChart3 size={18} />}
          />
        )}
        {state === "ready" && data && hasSuccess && (
          <div className="flex flex-1 flex-col">
            <div className="sr-only" aria-live="polite">
              {chartSummary}
            </div>
            <div className="monthly-chart-frame">
              <svg
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                preserveAspectRatio="none"
                className="monthly-chart-svg absolute inset-0 overflow-visible"
                role="img"
                aria-label={chartSummary}
              >
                <defs>
                  <linearGradient id="monthlySuccessArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgb(37 99 235)" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="rgb(37 99 235)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {Array.from({ length: 5 }).map((_, line) => {
                  const y = CHART_TOP + ((CHART_BASELINE - CHART_TOP) / 4) * line;
                  return (
                    <line
                      key={line}
                      x1={CHART_LEFT}
                      x2={CHART_WIDTH - CHART_RIGHT}
                      y1={y}
                      y2={y}
                      className={line === 4 ? "stroke-slate-300/90 dark:stroke-slate-600/80" : "stroke-slate-200 dark:stroke-slate-700/90"}
                      strokeDasharray={line === 4 ? undefined : "5 8"}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}

                <path d={chart.areaPath} fill="url(#monthlySuccessArea)" />
                <path
                  d={chart.linePath}
                  fill="none"
                  className="stroke-blue-600 dark:stroke-blue-400"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="4.25"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              {chart.points.map((point) => (
                <div key={`point-${point.month}`}>
                  {point.successCount > 0 && (
                    <div
                      className="monthly-chart-value"
                      style={{ left: `${point.xPercent}%`, top: `${Math.max(5, point.yPercent - 5.5)}%` }}
                    >
                      {point.successCount}
                    </div>
                  )}
                  <div
                    className="monthly-chart-dot"
                    style={{ left: `${point.xPercent}%`, top: `${point.yPercent}%` }}
                    aria-hidden="true"
                  />
                  <div className="monthly-chart-month" style={{ left: `${point.labelPercent}%` }}>
                    {point.label}
                  </div>
                </div>
              ))}

              {chart.points.map((point) => (
                <div
                  key={`tip-${point.month}`}
                  className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${point.xPercent}%`, top: `${point.yPercent}%` }}
                >
                  <button type="button" className="h-8 w-8 cursor-default rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={pointTooltip(point, data.year)} />
                  <div
                    className={cn(
                      "pointer-events-none absolute bottom-8 left-1/2 hidden w-52 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-sm leading-6 text-slate-600 shadow-lg shadow-slate-950/10 group-hover:block group-focus-within:block dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
                      point.month === 1 && "left-0 translate-x-0",
                      point.month === 12 && "left-auto right-0 translate-x-0"
                    )}
                  >
                    <div className="font-semibold text-slate-950 dark:text-slate-100">{monthLongName(point.month)} {data.year}</div>
                    <div>Berhasil: {point.successCount} log</div>
                    <div>Total: {point.totalCount} log</div>
                    <div>Persentase: {point.successRate}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartSkeleton(): JSX.Element {
  return (
    <div className="monthly-chart-frame bg-slate-50 dark:bg-slate-950/60">
      <div className="soft-skeleton absolute inset-x-4 bottom-14 top-5 rounded-lg" />
      <div className="absolute bottom-5 left-4 right-4 grid grid-cols-12 gap-2">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="soft-skeleton h-3" />
        ))}
      </div>
    </div>
  );
}

function buildLineChart(months: MonthData[], maxValue: number): { points: ChartPoint[]; linePath: string; areaPath: string } {
  const plotWidth = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const plotHeight = CHART_BASELINE - CHART_TOP;
  const points = months.map((month, index) => {
    const x = CHART_LEFT + (plotWidth / Math.max(1, months.length - 1)) * index;
    const y = CHART_BASELINE - (month.successCount / maxValue) * plotHeight;
    const xPercent = (x / CHART_WIDTH) * 100;
    return {
      ...month,
      label: monthShortName(month.month) || month.label,
      x,
      y,
      xPercent,
      yPercent: (y / CHART_HEIGHT) * 100,
      labelPercent: xPercent
    };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath =
    points.length > 0
      ? `M ${points[0].x.toFixed(2)} ${CHART_BASELINE} ${points.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")} L ${points[points.length - 1].x.toFixed(2)} ${CHART_BASELINE} Z`
      : "";
  return { points, linePath, areaPath };
}

function buildChartSummary(data: MonthlySuccessResponse): string {
  return `Pengisian SKP berhasil tahun ${data.year}: total ${data.summary.totalSuccess} log berhasil.`;
}

function pointTooltip(point: ChartPoint, year: number): string {
  return `${monthLongName(point.month)} ${year}. Berhasil ${point.successCount} log. Total ${point.totalCount} log. Persentase ${point.successRate}%.`;
}

function monthLongName(month: number): string {
  const names = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return names[month - 1] ?? "";
}

function monthShortName(month: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return names[month - 1] ?? "";
}
