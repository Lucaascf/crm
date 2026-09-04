"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { updateClient } from "@/app/actions/clients";
import { formatCurrency, formatDate, toDateInputValue } from "@/lib/date";
import { PROPERTY_TYPES } from "@/lib/constants";
import { inputClass, labelClass } from "@/lib/formStyles";

type ClientInfo = {
  id: string;
  name: string;
  whatsapp: string;
  originAddress: string | null;
  destinationAddress: string | null;
  movingDate: Date | null;
  movingTime: string | null;
  propertyType: string | null;
  movingNotes: string | null;
  budgetValue: number | null;
  budgetNotes: string | null;
};

export default function EditableInfo({ client }: { client: ClientInfo }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between">
          <div />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-orange-700 border border-neutral-200 hover:border-orange-200 rounded-lg px-3 py-1.5"
          >
            <Pencil size={14} />
            Editar
          </button>
        </div>

        <section>
          <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
            Mudança
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
            <InfoField label="Origem" value={client.originAddress} span />
            <InfoField label="Destino" value={client.destinationAddress} span />
            <InfoField label="Data" value={client.movingDate ? formatDate(client.movingDate) : null} />
            <InfoField label="Horário" value={client.movingTime} />
            <InfoField label="Tipo" value={client.propertyType} span />
          </div>
          {client.movingNotes && (
            <div className="mt-3 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-600 whitespace-pre-wrap">
              {client.movingNotes}
            </div>
          )}
        </section>

        <section>
          <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
            Orçamento
          </p>
          <p className="text-2xl font-bold text-neutral-900">
            {client.budgetValue ? formatCurrency(client.budgetValue) : "Não informado"}
          </p>
          {client.budgetNotes && (
            <div className="mt-3 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-600 whitespace-pre-wrap">
              {client.budgetNotes}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <form
      action={async (formData) => {
        await updateClient(client.id, formData);
        setEditing(false);
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
          Editando informações
        </p>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800"
        >
          <X size={16} />
          Cancelar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className={labelClass}>Nome</label>
          <input name="name" defaultValue={client.name} required className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>WhatsApp</label>
          <input name="whatsapp" defaultValue={client.whatsapp} required className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Mudança</p>
        <div>
          <label className={labelClass}>Origem</label>
          <input name="originAddress" defaultValue={client.originAddress ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Destino</label>
          <input
            name="destinationAddress"
            defaultValue={client.destinationAddress ?? ""}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Data</label>
            <input
              type="date"
              name="movingDate"
              defaultValue={toDateInputValue(client.movingDate)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Horário</label>
            <input
              type="time"
              name="movingTime"
              defaultValue={client.movingTime ?? ""}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Tipo de imóvel</label>
          <select name="propertyType" defaultValue={client.propertyType ?? ""} className={inputClass}>
            <option value="">Selecione...</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Observações</label>
          <textarea
            name="movingNotes"
            defaultValue={client.movingNotes ?? ""}
            rows={3}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Orçamento</p>
        <div>
          <label className={labelClass}>Valor (R$)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            name="budgetValue"
            defaultValue={client.budgetValue ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Observações do orçamento</label>
          <textarea
            name="budgetNotes"
            defaultValue={client.budgetNotes ?? ""}
            rows={2}
            className={inputClass}
          />
        </div>
      </div>

      <button
        type="submit"
        className="bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-6 py-3"
      >
        Salvar alterações
      </button>
    </form>
  );
}

function InfoField({
  label,
  value,
  span,
}: {
  label: string;
  value: string | null | undefined;
  span?: boolean;
}) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="text-neutral-800 font-medium">{value || "—"}</p>
    </div>
  );
}
