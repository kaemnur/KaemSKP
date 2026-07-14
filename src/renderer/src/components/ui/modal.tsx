import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Modal({
  title,
  description,
  children,
  onClose,
  className
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}): JSX.Element {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className={cn("modal-panel max-w-4xl", className)}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div id="modal-title" className="text-base font-semibold text-slate-950 dark:text-slate-100">
              {title}
            </div>
            {description && <div className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</div>}
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Tutup modal" title="Tutup">
            <X size={17} />
          </Button>
        </div>
        <div className="max-h-[calc(92vh-73px)] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
