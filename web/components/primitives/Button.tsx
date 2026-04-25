"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "text";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant = "primary", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center px-4 h-10",
          "text-sm font-medium tracking-tight",
          "transition-all duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          "disabled:opacity-40 disabled:pointer-events-none",
          variant === "primary" &&
            "bg-ink-90 text-paper-0 hover:bg-accent-indigo",
          variant === "ghost" &&
            "border border-rule text-ink-90 hover:bg-paper-2",
          variant === "text" &&
            "text-ink-60 hover:text-ink-90 underline-offset-4 hover:underline",
          className,
        )}
        {...props}
      />
    );
  },
);
