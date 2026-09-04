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
