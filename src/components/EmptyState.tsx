import { ReactNode } from "react";

export default function EmptyState({
  emoji,
  title,
  subtitle,
  action,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl border border-dashed border-neutral-300 bg-white/60">
      <div className="text-4xl mb-3">{emoji}</div>
      <p className="font-semibold text-neutral-700">{title}</p>
      {subtitle && <p className="text-sm text-neutral-500 mt-1 max-w-xs">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
