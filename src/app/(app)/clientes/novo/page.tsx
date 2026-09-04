import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/app/actions/clients";
import { PROPERTY_TYPES, STATUS_ORDER, STATUS } from "@/lib/constants";
import { inputClass, labelClass, sectionClass, sectionTitleClass } from "@/lib/formStyles";

export default function NovoClientePage() {
  return (
    <div className="pb-24 md:pb-8">
      <div className="px-4 pt-6 pb-2 md:px-8 md:pt-8">
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 mb-2"
        >
          <ChevronLeft size={16} />
          Clientes
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900">Novo cliente</h1>
      </div>

      <form action={createClient} className="px-4 md:px-8 flex flex-col gap-4 max-w-2xl">
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>Cliente</h2>
          <div>
            <label className={labelClass} htmlFor="name">
              Nome *
            </label>
            <input
              id="name"
              name="name"
              required
              autoFocus
              placeholder="Ex: Carlos Silva"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="whatsapp">
              WhatsApp *
            </label>
            <input
              id="whatsapp"
              name="whatsapp"
              required
              placeholder="(71) 99999-9999"
              className={inputClass}
            />
          </div>
        </div>

        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>Mudança</h2>
          <div>
            <label className={labelClass} htmlFor="originAddress">
              Endereço de origem
            </label>
            <input
              id="originAddress"
              name="originAddress"
              placeholder="Ex: Salvador - BA"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="destinationAddress">
              Endereço de destino
            </label>
            <input
              id="destinationAddress"
              name="destinationAddress"
              placeholder="Ex: Feira de Santana - BA"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} htmlFor="movingDate">
                Data da mudança
              </label>
              <input id="movingDate" name="movingDate" type="date" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="movingTime">
                Horário
              </label>
              <input id="movingTime" name="movingTime" type="time" className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="propertyType">
              Tipo de imóvel
            </label>
            <select id="propertyType" name="propertyType" className={inputClass} defaultValue="">
              <option value="" disabled>
                Selecione...
              </option>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="movingNotes">
              Observações
            </label>
            <textarea
              id="movingNotes"
              name="movingNotes"
              rows={3}
              placeholder="Ex: aproximadamente 20 caixas, sofá, cama e geladeira."
              className={inputClass}
            />
          </div>
        </div>

        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>Orçamento</h2>
          <div>
            <label className={labelClass} htmlFor="budgetValue">
              Valor do orçamento (R$)
            </label>
            <input
              id="budgetValue"
              name="budgetValue"
              type="number"
              step="0.01"
              min="0"
              placeholder="Ex: 1800"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="budgetNotes">
              Observações do orçamento
            </label>
            <textarea id="budgetNotes" name="budgetNotes" rows={2} className={inputClass} />
          </div>
        </div>

        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>Negociação</h2>
          <div>
            <label className={labelClass} htmlFor="status">
              Status
            </label>
            <select id="status" name="status" className={inputClass} defaultValue="NOVO_CONTATO">
              {STATUS_ORDER.map((key) => (
                <option key={key} value={key}>
                  {STATUS[key].emoji} {STATUS[key].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 pb-4">
          <button
            type="submit"
            className="flex-1 md:flex-none bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-6 py-3"
          >
            Salvar cliente
          </button>
          <Link
            href="/clientes"
            className="flex-1 md:flex-none text-center border border-neutral-300 text-neutral-600 font-semibold rounded-xl px-6 py-3 hover:bg-neutral-50"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
