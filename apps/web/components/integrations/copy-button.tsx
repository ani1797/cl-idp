"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type CopyState = "idle" | "copied" | "manual";

async function copyValue(value: string, fallbackTarget?: HTMLElement | null): Promise<CopyState> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return "copied";
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      if (document.execCommand("copy")) {
        return "copied";
      }
    } finally {
      document.body.removeChild(textarea);
    }
  }

  if (fallbackTarget && typeof document !== "undefined") {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(fallbackTarget);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  return "manual";
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  manualLabel = "Select text",
  className,
  fallbackTargetRef,
  size = "sm",
  variant = "ghost",
  iconOnly = false,
  disabled = false,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  manualLabel?: string;
  className?: string;
  fallbackTargetRef?: RefObject<HTMLElement | null>;
  size?: "xs" | "sm" | "icon-xs" | "icon-sm";
  variant?: "ghost" | "outline";
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const buttonLabel = state === "copied" ? copiedLabel : state === "manual" ? manualLabel : label;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("shrink-0", className)}
      aria-label={buttonLabel}
      disabled={disabled}
      onClick={async () => {
        const nextState = await copyValue(value, fallbackTargetRef?.current);
        setState(nextState);
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => setState("idle"), 1600);
      }}
    >
      <Icon name={state === "copied" ? "check" : "content_copy"} size={14} />
      {iconOnly ? <span className="sr-only">{buttonLabel}</span> : <span>{buttonLabel}</span>}
    </Button>
  );
}
