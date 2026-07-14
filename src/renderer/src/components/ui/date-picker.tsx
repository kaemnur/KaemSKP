import { CalendarDays } from "lucide-react";
import { Label } from "@/components/ui/field";
import { cn, formatDateID, toDateInputValue } from "@/lib/utils";

export function DatePickerField({
  id,
  label,
  value,
  onChange,
  className
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}): JSX.Element {
  const dateValue = toDateInputValue(value);
  const displayValue = formatDateID(dateValue);

  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative h-10">
        <div
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm shadow-slate-950/[0.02] transition duration-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
            !displayValue && "text-slate-400 dark:text-slate-500"
          )}
        >
          <span>{displayValue || "dd/MM/yyyy"}</span>
          <CalendarDays className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </div>
        <input
          id={id}
          aria-label={label}
          className="absolute inset-0 h-10 w-full cursor-pointer opacity-0"
          lang="id-ID"
          type="date"
          value={dateValue}
          onChange={(event) => onChange(toDateInputValue(event.target.value))}
        />
      </div>
    </div>
  );
}
