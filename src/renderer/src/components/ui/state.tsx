import type { ReactNode } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type NoticeTone = "success" | "warning" | "danger" | "info";

export function Notice({ tone = "info", children, className }: { tone?: NoticeTone; children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn("notice", `notice-${tone}`, className)}>{children}</div>;
}

export function EmptyState({
  title,
  description,
  action,
  icon
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon ?? <Inbox size={18} />}</div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-description">{description}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Proses belum berhasil",
  message,
  code,
  detail,
  onRetry
}: {
  title?: string;
  message: string;
  code?: string;
  detail?: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{title}</div>
          <div className="mt-1 leading-6">{message}</div>
          {code && <div className="mt-2 inline-flex rounded-md bg-white/70 px-2 py-1 text-xs font-medium dark:bg-slate-950/50">Kode: {code}</div>}
          {detail && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold">Detail teknis</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-white/75 p-3 text-xs leading-5 text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">{detail}</pre>
            </details>
          )}
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="cursor-pointer rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-500/30 dark:bg-slate-950/40 dark:text-red-300">
            Coba Lagi
          </button>
        )}
      </div>
    </div>
  );
}

export function LoadingState({ label = "Memuat data..." }: { label?: string }): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
      <div className="empty-state-title">{label}</div>
      <div className="mt-4 w-full max-w-md space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="soft-skeleton h-8" />
        ))}
      </div>
    </div>
  );
}
