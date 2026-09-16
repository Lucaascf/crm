"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId, assertOwnsClient } from "@/lib/auth";
import { formatCurrency } from "@/lib/date";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function num(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(formData: FormData, key: string): Date | null {
  const v = str(formData, key);
  if (v === null) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createClient(formData: FormData) {
  const userId = requireUserId();
  const name = str(formData, "name");
  const whatsapp = str(formData, "whatsapp");
  if (!name || !whatsapp) {
    throw new Error("Nome e WhatsApp são obrigatórios.");
  }

  const client = await prisma.client.create({
    data: {
      userId,
      name,
      whatsapp,
      originAddress: str(formData, "originAddress"),
      destinationAddress: str(formData, "destinationAddress"),
      movingDate: dateOrNull(formData, "movingDate"),
      movingTime: str(formData, "movingTime"),
      propertyType: str(formData, "propertyType"),
      movingNotes: str(formData, "movingNotes"),
      stairsOrElevator: str(formData, "stairsOrElevator"),
      truckAccess: str(formData, "truckAccess"),
      budgetValue: num(formData, "budgetValue"),
      budgetNotes: str(formData, "budgetNotes"),
      status: str(formData, "status") ?? "NOVO_CONTATO",
      nameConfirmed: true,
      historyEntries: {
        create: { text: "Cliente cadastrado." },
      },
    },
  });

  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/funil");
  redirect(`/clientes/${client.id}`);
}

export async function updateClient(clientId: string, formData: FormData) {
  const userId = requireUserId();
  await assertOwnsClient(clientId, userId);

  const name = str(formData, "name");
  const whatsapp = str(formData, "whatsapp");
  if (!name || !whatsapp) {
    throw new Error("Nome e WhatsApp são obrigatórios.");
  }

  await prisma.client.update({
    where: { id: clientId },
    data: {
      name,
      whatsapp,
      nameConfirmed: true,
      originAddress: str(formData, "originAddress"),
      destinationAddress: str(formData, "destinationAddress"),
      movingDate: dateOrNull(formData, "movingDate"),
      movingTime: str(formData, "movingTime"),
      propertyType: str(formData, "propertyType"),
      movingNotes: str(formData, "movingNotes"),
      stairsOrElevator: str(formData, "stairsOrElevator"),
      truckAccess: str(formData, "truckAccess"),
      budgetValue: num(formData, "budgetValue"),
      budgetNotes: str(formData, "budgetNotes"),
    },
  });

  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/funil");
  revalidatePath("/mudancas");
  revalidatePath(`/clientes/${clientId}`);
}

// Ação rápida: só o valor do orçamento, sem precisar abrir o formulário
// inteiro de edição. Se o bot já deixou o cliente esperando (awaitingBudget),
// é esse valor que o whatsapp-bot detecta e manda pro cliente automaticamente.
export async function setBudget(clientId: string, formData: FormData) {
  const userId = requireUserId();
  await assertOwnsClient(clientId, userId);

  const value = num(formData, "budgetValue");
  if (value === null) {
    throw new Error("Informe um valor de orçamento.");
  }

  await prisma.client.update({
    where: { id: clientId },
    data: {
      budgetValue: value,
      historyEntries: { create: { text: `Orçamento de ${formatCurrency(value)} definido.` } },
    },
  });

  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/funil");
  revalidatePath(`/clientes/${clientId}`);
}

export async function updateClientStatus(clientId: string, status: string) {
  const userId = requireUserId();
  await assertOwnsClient(clientId, userId);

  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      status,
      historyEntries: {
        create: { text: `Status alterado para "${statusLabel(status)}".` },
      },
    },
  });

  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/funil");
  revalidatePath(`/clientes/${client.id}`);
  return client;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    NOVO_CONTATO: "Novo contato",
    EM_ATENDIMENTO: "Em atendimento",
    ORCAMENTO_ENVIADO: "Orçamento enviado",
    AGUARDANDO_CLIENTE: "Aguardando cliente",
    FECHADO: "Fechado",
    NAO_FECHOU: "Não fechou",
  };
  return labels[status] ?? status;
}

export async function addHistoryEntry(clientId: string, formData: FormData) {
  const userId = requireUserId();
  await assertOwnsClient(clientId, userId);

  const text = str(formData, "text");
  if (!text) return;

  await prisma.historyEntry.create({
    data: { clientId, text },
  });

  revalidatePath(`/clientes/${clientId}`);
}

export async function searchClients(query: string) {
  const userId = requireUserId();
  const q = query.trim();
  if (!q) {
    return prisma.client.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  }
  return prisma.client.findMany({
    where: {
      userId,
      OR: [
        { name: { contains: q } },
        { whatsapp: { contains: q } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
}
