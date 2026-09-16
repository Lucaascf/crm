"use client";

import { useState } from "react";
import { confirmVistoria } from "@/app/actions/appointments";
import { formatDate, toDateInputValue } from "@/lib/date";
import { inputClass, labelClass } from "@/lib/formStyles";

type Vistoria = {
  id: string;
  date: Date;
  time: string | null;
  confirmedByUser: boolean;
  proposalSentAt: Date | null;
  clientAccepted: boolean | null;
};

export default function VistoriaCard({ vistoria }: { vistoria: Vistoria }) {
  const [editing, setEditing] = useState(false);
  const confirmAction = confirmVistoria.bind(null, vistoria.id);

  let statusLabel = "A confirmar";
  let statusColor = "bg-neutral-100 text-neutral-600 border-neutral-200";
  if (vistoria.clientAccepted === true) {
    statusLabel = "Cliente confirmou";
    statusColor = "bg-emerald-100 text-emerald-800 border-emerald-200";
  } else if (vistoria.clientAccepted === false) {
    statusLabel = "Cliente pediu outro horário";
    statusColor = "bg-rose-100 text-rose-800 border-rose-200";
  } else if (vistoria.confirmedByUser) {
    statusLabel = "Aguardando resposta do cliente";
    statusColor = "bg-amber-100 text-amber-800 border-amber-200";
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Vistoria</p>
        <span className={`text-xs font-bold rounded-full px-2.5 py-1 border ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {!editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-neutral-900">
              {formatDate(vistoria.date)}
              {vistoria.time ? ` às ${vistoria.time}` : ""}
            </p>
            <p className="text-sm text-neutral-500">Sugerido pelo cliente na conversa.</p>
          </div>
          <div className="flex gap-2">
            {!vistoria.confirmedByUser && (
              <form action={confirmAction}>
                <input type="hidden" name="date" value={toDateInputValue(vistoria.date)} />
                <input type="hidden" name="time" value={vistoria.time ?? ""} />
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-3 py-2 text-sm"
                >
                  Confirmar
                </button>
              </form>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            >
              Mudar horário
            </button>
          </div>
        </div>
      ) : (
        <form
          action={async (formData) => {
            await confirmAction(formData);
            setEditing(false);
          }}
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Data</label>
              <input
                type="date"
                name="date"
                defaultValue={toDateInputValue(vistoria.date)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Horário</label>
              <input type="time" name="time" defaultValue={vistoria.time ?? ""} className={inputClass} />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2 text-sm"
            >
              Confirmar e enviar
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border border-neutral-200 rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
