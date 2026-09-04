"use client";

import { useTransition } from "react";
import { STATUS, STATUS_ORDER } from "@/lib/constants";
import { updateClientStatus } from "@/app/actions/clients";

export default function StatusPicker({
  clientId,
  status,
}: {
  clientId: string;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
        Status
      </p>
      <select
        value={status}
        disabled={isPending}
        onChange={(e) =>
          startTransition(() => {
            updateClientStatus(clientId, e.target.value);
          })
        }
        className={`w-full md:w-auto rounded-xl border px-4 py-2.5 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500 ${
          STATUS[status as keyof typeof STATUS]?.color ?? "bg-white border-neutral-300"
        } ${isPending ? "opacity-60" : ""}`}
      >
        {STATUS_ORDER.map((key) => (
          <option key={key} value={key}>
            {STATUS[key].emoji} {STATUS[key].label}
          </option>
        ))}
      </select>
    </div>
  );
}
