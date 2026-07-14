import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tabs({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn("tab-list", className)}>{children}</div>;
}

export function TabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <button type="button" onClick={onClick} className={cn("tab-button", active && "tab-button-active")}>
      {children}
    </button>
  );
}
