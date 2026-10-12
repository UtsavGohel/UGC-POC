/**
 * Button styles. Kept out of ui.tsx ("use client") because server components
 * call buttonClass() directly, and client modules can only be rendered from
 * the server, not called.
 */
const BUTTON_STYLES = {
  primary: "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200",
  secondary:
    "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400",
} as const;

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  const sizing = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON_STYLES[variant]}`;
}

export type ButtonVariant = keyof typeof BUTTON_STYLES;
