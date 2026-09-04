import Link from "next/link";

export default function TodayItem({
  href,
  title,
  subtitle,
  time,
}: {
  href: string;
  title: string;
  subtitle?: string;
  time?: string | null;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 -mx-1 hover:bg-neutral-50 transition-colors"
      >
        <div className="min-w-0">
          <p className="font-medium text-neutral-800 truncate">{title}</p>
          {subtitle && <p className="text-xs text-neutral-500 truncate">{subtitle}</p>}
        </div>
        {time && (
          <span className="text-sm font-semibold text-neutral-500 shrink-0">{time}</span>
        )}
      </Link>
    </li>
  );
}
