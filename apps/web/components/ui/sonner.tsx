"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

import { Icon } from "@/components/ui/icon";

/**
 * Dark mode is driven by the `.dark` class on <html>, so Sonner is left on its
 * default rather than pulling in next-themes.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <Icon name="check_circle" size={16} className="text-success" />,
        info: <Icon name="info" size={16} className="text-info" />,
        warning: <Icon name="warning" size={16} className="text-warning" />,
        error: <Icon name="error" size={16} className="text-destructive" />,
        loading: <Icon name="progress_activity" size={16} className="animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
