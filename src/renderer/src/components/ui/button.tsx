import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps): JSX.Element {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border font-medium shadow-sm transition duration-200 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "border-blue-700 bg-blue-700 text-white shadow-blue-950/10 hover:bg-blue-800 dark:border-blue-500 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400",
        variant === "secondary" && "border-slate-200 bg-white text-slate-800 shadow-slate-950/[0.03] hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800",
        variant === "ghost" && "border-transparent bg-transparent text-slate-700 shadow-none hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
        variant === "danger" && "border-red-700 bg-red-700 text-white shadow-red-950/10 hover:bg-red-800 dark:border-red-500 dark:bg-red-500 dark:text-white dark:hover:bg-red-600",
        size === "sm" && "h-9 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "icon" && "h-10 w-10 p-0",
        className
      )}
      {...props}
    />
  );
}
