"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface ProgressiveBlurProps {
  className?: string;
  height?: string;
  position?: "top" | "bottom" | "both";
}

function edgeClasses(position: NonNullable<ProgressiveBlurProps["position"]>) {
  if (position === "top") return "top-0";
  if (position === "bottom") return "bottom-0";
  return "inset-y-0";
}

function edgeBackground(position: NonNullable<ProgressiveBlurProps["position"]>) {
  if (position === "top") {
    return "linear-gradient(to bottom, color-mix(in oklab, var(--card) 92%, transparent), color-mix(in oklab, var(--card) 68%, transparent) 35%, transparent 100%)";
  }
  if (position === "bottom") {
    return "linear-gradient(to top, color-mix(in oklab, var(--card) 92%, transparent), color-mix(in oklab, var(--card) 68%, transparent) 35%, transparent 100%)";
  }
  return "linear-gradient(to bottom, color-mix(in oklab, var(--card) 92%, transparent), transparent 15%, transparent 85%, color-mix(in oklab, var(--card) 92%, transparent) 100%)";
}

export function ProgressiveBlur({
  className,
  height = "4rem",
  position = "bottom",
}: ProgressiveBlurProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 overflow-hidden",
        edgeClasses(position),
        className
      )}
      style={{ height: position === "both" ? "100%" : height }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: edgeBackground(position),
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      />
    </div>
  );
}
