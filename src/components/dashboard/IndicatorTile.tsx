import Link from "next/link";

export default function IndicatorTile({
  href,
  value,
  label,
  color,
}: {
  href: string;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-2xl border border-neutral-200 bg-white p-4 hover:border-neutral-300 hover:shadow-sm transition-all"
    >
      <span className={`text-3xl font-bold ${color}`}>{value}</span>
      <span className="text-sm font-medium text-neutral-500">{label}</span>
    </Link>
  );
}
