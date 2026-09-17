"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteClient } from "@/app/actions/clients";

export default function DeleteClientButton({ id, name }: { id: string; name: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (
          confirm(
            `Excluir ${name}? Isso apaga todo o histórico e as mensagens da conversa. Não tem como desfazer.`,
          )
        ) {
          startTransition(() => deleteClient(id));
        }
      }}
      className="flex items-center gap-1.5 text-sm font-medium text-neutral-400 hover:text-rose-600 border border-neutral-200 hover:border-rose-200 rounded-lg px-3 py-1.5 disabled:opacity-50"
    >
      <Trash2 size={14} />
      Excluir
    </button>
  );
}
