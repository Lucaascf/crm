"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { updateClient, setBudget } from "@/app/actions/clients";
import { formatCurrency, formatDate, formatDateTime, toDateInputValue } from "@/lib/date";
import { PROPERTY_TYPES } from "@/lib/constants";
import { inputClass, labelClass } from "@/lib/formStyles";
import CurrencyInput from "@/components/CurrencyInput";

type ClientInfo = {
  id: string;
  name: string;
  whatsapp: string;
  originAddress: string | null;
  destinationAddress: string | null;
  movingDate: Date | null;
  propertyType: string | null;
  movingNotes: string | null;
  stairsOrElevator: string | null;
  truckAccess: string | null;
  budgetValue: number | null;
  budgetNotes: string | null;
  commercialNotes: string | null;
  awaitingBudget: boolean;
  budgetSentAt: Date | null;
};

export default function EditableInfo({ client }: { client: ClientInfo }) {
  const [editing, setEditing] = useState(false);
  const setBudgetAction = setBudget.bind(null, client.id);

  if (!editing) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-2">
          {client.awaitingBudget ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-3 py-1.5">
              ⏳ Só falta o orçamento
            </span>
          ) : (
            <div />
          )}
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
            <InfoField label="Tipo de imóvel" value={client.propertyType} span />
            <InfoField label="Escada/elevador" value={client.stairsOrElevator} span />
            <InfoField label="Caminhão na porta" value={client.truckAccess} span />
          </div>
        </section>

        <section>
          <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
            Itens a transportar
          </p>
          {client.movingNotes ? (
            <div className="rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-600 whitespace-pre-wrap">
              {client.movingNotes}
            </div>
          ) : (
            <p className="text-sm text-neutral-400">Ainda não informado.</p>
          )}
        </section>

        <section>
          <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
            Orçamento
          </p>
          {client.commercialNotes && (
            <div className="mb-3 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-600 whitespace-pre-wrap">
              <p className="font-semibold mb-1">Condições mencionadas na conversa</p>
              {client.commercialNotes}
            </div>
          )}
          {client.budgetValue ? (
            <>
              <p className="text-2xl font-bold text-neutral-900">{formatCurrency(client.budgetValue)}</p>
              {client.budgetSentAt ? (
                <p className="text-xs font-medium text-emerald-700 mt-1.5">
                  ✓ Enviado pro cliente em {formatDateTime(client.budgetSentAt)}
                </p>
              ) : client.awaitingBudget ? (
                <p className="text-xs font-medium text-amber-700 mt-1.5">
                  Mandando pro cliente em instantes...
                </p>
              ) : null}
              {client.budgetNotes && (
                <div className="mt-3 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-600 whitespace-pre-wrap">
                  {client.budgetNotes}
                </div>
              )}
            </>
          ) : (
            <form action={setBudgetAction} className="flex items-center gap-2">
              <CurrencyInput name="budgetValue" defaultValue={null} className={inputClass} />
              <button
                type="submit"
                className="shrink-0 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-2.5"
              >
                Enviar orçamento
              </button>
            </form>
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
          <label className={labelClass}>Escada ou elevador (origem e destino)</label>
          <input
            name="stairsOrElevator"
            defaultValue={client.stairsOrElevator ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Caminhão consegue parar na porta?</label>
          <input name="truckAccess" defaultValue={client.truckAccess ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Itens a transportar</label>
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
          <label className={labelClass}>Valor</label>
          <CurrencyInput name="budgetValue" defaultValue={client.budgetValue} className={inputClass} />
          {client.awaitingBudget && (
            <p className="text-xs text-amber-700 mt-1.5">
              Assim que salvar, o bot manda esse valor pro cliente automaticamente (em até ~20s).
            </p>
          )}
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
