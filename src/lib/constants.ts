// Status possíveis de um cliente no funil de negociação.
// Não adicionar novos status sem necessidade — a regra do produto é
// manter o fluxo simples e fácil de entender.

export type StatusKey =
  | "NOVO_CONTATO"
  | "EM_ATENDIMENTO"
  | "ORCAMENTO_ENVIADO"
  | "AGUARDANDO_CLIENTE"
  | "FECHADO"
  | "NAO_FECHOU";

export const STATUS_ORDER: StatusKey[] = [
  "NOVO_CONTATO",
  "EM_ATENDIMENTO",
  "ORCAMENTO_ENVIADO",
  "AGUARDANDO_CLIENTE",
  "FECHADO",
  "NAO_FECHOU",
];

export const STATUS: Record<
  StatusKey,
  { label: string; emoji: string; color: string; dot: string }
> = {
  NOVO_CONTATO: {
    label: "Novo contato",
    emoji: "🆕",
    color: "bg-sky-100 text-sky-800 border-sky-200",
    dot: "bg-sky-500",
  },
  EM_ATENDIMENTO: {
    label: "Em atendimento",
    emoji: "💬",
    color: "bg-indigo-100 text-indigo-800 border-indigo-200",
    dot: "bg-indigo-500",
  },
  ORCAMENTO_ENVIADO: {
    label: "Orçamento enviado",
    emoji: "🟡",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
  },
  AGUARDANDO_CLIENTE: {
    label: "Aguardando cliente",
    emoji: "⏳",
    color: "bg-orange-100 text-orange-800 border-orange-200",
    dot: "bg-orange-500",
  },
  FECHADO: {
    label: "Fechado",
    emoji: "✅",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
  },
  NAO_FECHOU: {
    label: "Não fechou",
    emoji: "❌",
    color: "bg-rose-100 text-rose-800 border-rose-200",
    dot: "bg-rose-500",
  },
};

export type AppointmentTypeKey = "VISTORIA" | "MUDANCA" | "RETORNO" | "FOLLOWUP";

export const APPOINTMENT_TYPE_ORDER: AppointmentTypeKey[] = [
  "VISTORIA",
  "MUDANCA",
  "RETORNO",
  "FOLLOWUP",
];

export const APPOINTMENT_TYPE: Record<
  AppointmentTypeKey,
  { label: string; emoji: string }
> = {
  VISTORIA: { label: "Vistoria", emoji: "🏠" },
  MUDANCA: { label: "Mudança", emoji: "🚚" },
  RETORNO: { label: "Retorno", emoji: "📞" },
  FOLLOWUP: { label: "Follow-up", emoji: "🔄" },
};

export const PROPERTY_TYPES = [
  "Apartamento",
  "Casa",
  "Kitnet/Studio",
  "Sala comercial",
  "Escritório",
  "Depósito/Galpão",
  "Outro",
];
