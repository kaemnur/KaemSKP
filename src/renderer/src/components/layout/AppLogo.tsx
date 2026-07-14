import { cn } from "@/lib/utils";

export const APP_LOGO_SRC = "/assets/KaemSKP_logo.png?v=1";

type AppLogoProps = {
  className?: string;
  compact?: boolean;
};

export function AppLogo({ className, compact = false }: AppLogoProps): JSX.Element {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm shadow-slate-950/[0.06] dark:border-white/10 dark:bg-white">
        <img src={APP_LOGO_SRC} alt="Logo KaemSKP" className="h-full w-full object-contain" draggable={false} />
      </div>
      {!compact && (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">KaemSKP</div>
          <div className="truncate text-xs leading-5 text-slate-500 dark:text-slate-400">Log Harian SKP lokal</div>
        </div>
      )}
    </div>
  );
}
