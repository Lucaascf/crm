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

export async function createTask(formData: FormData) {
  const userId = requireUserId();
  const title = str(formData, "title");
  const dateStr = str(formData, "date");
  if (!title || !dateStr) {
    throw new Error("Título e data são obrigatórios.");
  }

  const date = new Date(`${dateStr}T00:00:00`);
  const clientId = str(formData, "clientId");
  if (clientId) await assertOwnsClient(clientId, userId);

  await prisma.task.create({
    data: {
      userId,
      title,
      date,
      time: str(formData, "time"),
      notes: str(formData, "notes"),
      clientId: clientId ?? undefined,
    },
  });

  revalidatePath("/");
  revalidatePath("/tarefas");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
}

export async function toggleTaskDone(id: string, done: boolean) {
  const userId = requireUserId();
  const existing = await prisma.task.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Tarefa não encontrada.");

  const task = await prisma.task.update({
    where: { id },
    data: { done },
  });

  revalidatePath("/");
  revalidatePath("/tarefas");
  if (task.clientId) revalidatePath(`/clientes/${task.clientId}`);
}

export async function deleteTask(id: string) {
  const userId = requireUserId();
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) return;

  await prisma.task.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/tarefas");
  if (task.clientId) revalidatePath(`/clientes/${task.clientId}`);
}
