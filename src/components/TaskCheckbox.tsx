"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { toggleTaskDone } from "@/app/actions/tasks";

export default function TaskCheckbox({
  id,
  done,
}: {
  id: string;
  done: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label={done ? "Marcar como pendente" : "Marcar como concluída"}
      disabled={isPending}
      onClick={() => startTransition(() => toggleTaskDone(id, !done))}
      className={`flex items-center justify-center w-6 h-6 rounded-full border-2 shrink-0 transition-colors ${
        done
          ? "bg-emerald-500 border-emerald-500 text-white"
          : "border-neutral-300 text-transparent hover:border-orange-400"
      } ${isPending ? "opacity-50" : ""}`}
    >
      <Check size={15} strokeWidth={3} />
    </button>
  );
}
