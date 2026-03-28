"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/useTheme";
import type { AppStep } from "@/lib/store";

const STEPS: { id: AppStep; label: string; num: number }[] = [
  { id: "setup", label: "Scenario", num: 1 },
  { id: "scrape", label: "Sources", num: 2 },
  { id: "simulate", label: "Simulate", num: 3 },
  { id: "report", label: "Report", num: 4 },
];

export function StepHeader({ current }: { current: AppStep }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  const { dark, toggle } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  return (
    <header className="border-b bg-background/80 backdrop-blur-md sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-foreground flex items-center justify-center shrink-0">
            <span className="text-background text-[10px] font-bold tracking-tighter">OF</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">Oracle Fish</span>
        </div>

        {/* Steps */}
        <nav className="flex items-center gap-0.5">
          {STEPS.map((step, idx) => {
            const done = idx < currentIdx;
            const active = idx === currentIdx;
            const future = idx > currentIdx;
            return (
              <div key={step.id} className="flex items-center">
                <div
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
                    active && "bg-foreground text-background",
                    done && "text-foreground/70",
                    future && "text-muted-foreground/40"
                  )}
                >
                  <span
                    className={cn(
                      "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                      active && "bg-background/20",
                      done && "bg-foreground text-background",
                      future && "bg-muted"
                    )}
                  >
                    {done ? (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M1.5 4L3 5.5L6.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      step.num
                    )}
                  </span>
                  <span className={cn(future && "hidden sm:block")}>{step.label}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={cn(
                    "w-4 h-px mx-0.5 transition-colors",
                    done ? "bg-foreground/30" : "bg-border"
                  )} />
                )}
              </div>
            );
          })}
        </nav>

        {/* Theme toggle */}
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {mounted ? (
            dark ? <Sun size={15} /> : <Moon size={15} />
          ) : (
            <span className="block h-[15px] w-[15px]" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
