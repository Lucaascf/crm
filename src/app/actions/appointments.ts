"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId, assertOwnsClient } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export async function createAppointment(formData: FormData) {
  const userId = requireUserId();
  const title = str(formData, "title");
  const type = str(formData, "type");
  const dateStr = str(formData, "date");
  if (!title || !type || !dateStr) {
    throw new Error("Título, tipo e data são obrigatórios.");
  }

  const date = new Date(`${dateStr}T00:00:00`);
  const clientId = str(formData, "clientId");
  if (clientId) await assertOwnsClient(clientId, userId);

  await prisma.appointment.create({
    data: {
      userId,
      title,
      type,
      date,
      time: str(formData, "time"),
      notes: str(formData, "notes"),
      clientId: clientId ?? undefined,
    },
  });

  revalidatePath("/");
  revalidatePath("/agenda");
  revalidatePath("/mudancas");
}

export async function deleteAppointment(id: string) {
  const userId = requireUserId();
  await prisma.appointment.deleteMany({ where: { id, userId } });
  revalidatePath("/");
  revalidatePath("/agenda");
  revalidatePath("/mudancas");
}

// Usuário confirma (ou ajusta) o dia/horário de uma vistoria proposta pelo
// cliente na conversa. Isso marca pra o bot mandar a confirmação pro
// cliente perguntando se aquele horário funciona (ver whatsapp-bot/src/vistoriaWatcher.js).
export async function confirmVistoria(appointmentId: string, formData: FormData) {
  const userId = requireUserId();
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, userId },
  });
  if (!appointment) throw new Error("Vistoria não encontrada.");

  const dateStr = str(formData, "date");
  if (!dateStr) throw new Error("Data é obrigatória.");

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      date: new Date(`${dateStr}T00:00:00`),
      time: str(formData, "time"),
      confirmedByUser: true,
      // Reabre o ciclo de proposta — se o horário mudou, o bot precisa
      // mandar a confirmação de novo pro cliente.
      proposalSentAt: null,
      clientRespondedAt: null,
      clientAccepted: null,
    },
  });

  if (appointment.clientId) {
    await prisma.historyEntry.create({
      data: {
        clientId: appointment.clientId,
        text: `Vistoria confirmada internamente para ${dateStr}${
          str(formData, "time") ? " às " + str(formData, "time") : ""
        } — aguardando o bot confirmar com o cliente.`,
      },
    });
  }

  revalidatePath("/");
  revalidatePath("/agenda");
  if (appointment.clientId) revalidatePath(`/clientes/${appointment.clientId}`);
}
