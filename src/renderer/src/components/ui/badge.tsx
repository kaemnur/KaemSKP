import { cn, statusClass, statusLabel } from "@/lib/utils";

export function Badge({ status, children, className }: { status?: string; children?: React.ReactNode; className?: string }): JSX.Element {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium leading-none", statusClass(status), className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {children ?? statusLabel(status)}
    </span>
  );
}
