import { STATUS, StatusKey } from "@/lib/constants";

export default function StatusBadge({ status }: { status: string }) {
  const info = STATUS[status as StatusKey] ?? {
    label: status,
    emoji: "•",
    color: "bg-neutral-100 text-neutral-700 border-neutral-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${info.color}`}
    >
      <span>{info.emoji}</span>
      {info.label}
    </span>
  );
}
