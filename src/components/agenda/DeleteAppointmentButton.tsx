"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteAppointment } from "@/app/actions/appointments";

export default function DeleteAppointmentButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label="Excluir compromisso"
      disabled={isPending}
      onClick={() => {
        if (confirm("Excluir este compromisso?")) {
          startTransition(() => deleteAppointment(id));
        }
      }}
      className="text-neutral-300 hover:text-rose-600 shrink-0"
    >
      <Trash2 size={16} />
    </button>
  );
}
