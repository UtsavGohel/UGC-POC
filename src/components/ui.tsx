"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { buttonClass, type ButtonVariant } from "./button-class";

/** Submit button that disables itself while its parent form's action runs. */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  disabled,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={buttonClass(variant, size)}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}

/** Re-fetches server data on an interval while background jobs are running. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => startTransition(() => router.refresh()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * Button for a bound server action that returns `{ error?, message? }`.
 * Shows the error inline and can ask for confirmation before paid actions.
 */
export function ActionButton({
  action,
  children,
  pendingText = "…",
  variant = "secondary",
  size = "sm",
  confirmText,
  title,
}: {
  action: () => Promise<{ error?: string; message?: string }>;
  children: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  confirmText?: string;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        title={title}
        disabled={pending}
        className={buttonClass(variant, size)}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          setError(undefined);
          startTransition(async () => {
            const result = await action();
            if (result?.error) setError(result.error);
          });
        }}
      >
        {pending ? pendingText : children}
      </button>
      {error && <span className="mt-1 max-w-56 text-right text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}
