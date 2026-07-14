import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TableCard({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cn("page-band table-scroll", className)}>
      {children}
    </div>
  );
}

export function DataTable({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <table className={cn("data-table", className)}>{children}</table>;
}
