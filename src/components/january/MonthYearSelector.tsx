"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getMonthLabel,
  PERIOD_START,
  PERIOD_END,
  generateMonthRange,
} from "@/lib/constants";

export interface MonthYearSelectorProps {
  value: string;
  onChange: (monthKey: string) => void;
}

/** Convierte YYYY-MM a [year, month] numerico. */
function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y ?? 0, month: m ?? 1 };
}

export const MonthYearSelector = ({
  value,
  onChange,
}: MonthYearSelectorProps): React.ReactElement => {
  const availableMonths = useQuery(api.januaryQueries.getAvailableMonths);

  const options = useMemo(() => {
    const base =
      availableMonths?.length
        ? availableMonths
        : generateMonthRange(PERIOD_START, PERIOD_END);
    if (value && !base.includes(value)) {
      return [value, ...base].sort((a, b) => b.localeCompare(a));
    }
    return base;
  }, [availableMonths, value]);

  const handleChange = useCallback(
    (v: string) => {
      if (v) onChange(v);
    },
    [onChange]
  );

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        className="w-[180px] bg-slate-800/60 border-slate-700/50 text-slate-200"
      >
        <SelectValue placeholder="Seleccionar mes" />
      </SelectTrigger>
      <SelectContent>
        {options.map((key) => {
          const { year, month } = parseMonthKey(key);
          return (
            <SelectItem key={key} value={key}>
              {getMonthLabel(year, month)}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};
