"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { createAppointment } from "@/app/actions/appointments";
import { APPOINTMENT_TYPE, APPOINTMENT_TYPE_ORDER } from "@/lib/constants";
import { inputClass, labelClass } from "@/lib/formStyles";

export default function NewAppointmentForm({
  clients,
  defaultClientId,
}: {
  clients: { id: string; name: string }[];
  defaultClientId?: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-2.5 shadow-sm"
      >
        <Plus size={18} />
        Novo compromisso
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await createAppointment(formData);
        formRef.current?.reset();
        setOpen(false);
      }}
      className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-neutral-800">Novo compromisso</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">
          <X size={18} />
        </button>
      </div>

      <div>
        <label className={labelClass}>Título</label>
        <input name="title" required placeholder="Ex: Retornar João" className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Tipo</label>
          <select name="type" required defaultValue="RETORNO" className={inputClass}>
            {APPOINTMENT_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {APPOINTMENT_TYPE[t].emoji} {APPOINTMENT_TYPE[t].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Cliente</label>
          <select name="clientId" defaultValue={defaultClientId ?? ""} className={inputClass}>
            <option value="">Nenhum</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Data</label>
          <input type="date" name="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Horário</label>
          <input type="time" name="time" className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Observação</label>
        <textarea name="notes" rows={2} className={inputClass} />
      </div>

      <button
        type="submit"
        className="bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-6 py-3"
      >
        Salvar compromisso
      </button>
    </form>
  );
}
