import Link from "next/link";
import { ReactNode } from "react";

export default function TodaySection({
  emoji,
  title,
  count,
  emptyText,
  seeAllHref,
  children,
}: {
  emoji: string;
  title: string;
  count: number;
  emptyText: string;
  seeAllHref?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-neutral-800 flex items-center gap-2">
          <span>{emoji}</span>
          {title}
          {count > 0 && (
            <span className="text-xs font-bold bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
              {count}
            </span>
          )}
        </h3>
        {seeAllHref && count > 0 && (
          <Link
            href={seeAllHref}
            className="text-xs font-medium text-orange-700 hover:underline shrink-0"
          >
            ver tudo
          </Link>
        )}
      </div>
      {count === 0 ? (
        <p className="text-sm text-neutral-400">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </div>
  );
}
