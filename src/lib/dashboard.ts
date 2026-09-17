import { prisma } from "@/lib/prisma";
import { addDays, todayStart } from "@/lib/date";

// Consultas usadas na tela inicial (painel do dia).
// Mantidas em um único lugar para a página inicial ficar simples de ler.

export async function getDashboardData(userId: string) {
  const today = todayStart();
  const tomorrow = addDays(today, 1);

  const [
    retornosHoje,
    vistoriasHoje,
    followupsHoje,
    mudancasHoje,
    orcamentosPendentes,
    tarefasHoje,
    tarefasAtrasadas,
    novosContatos,
    emAtendimento,
    aguardandoResposta,
    fechados,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: { userId, type: "RETORNO", date: { gte: today, lt: tomorrow } },
      include: { client: true },
      orderBy: { time: "asc" },
    }),
    prisma.appointment.findMany({
      where: { userId, type: "VISTORIA", date: { gte: today, lt: tomorrow } },
      include: { client: true },
      orderBy: { time: "asc" },
    }),
    prisma.appointment.findMany({
      where: { userId, type: "FOLLOWUP", date: { gte: today, lt: tomorrow } },
      include: { client: true },
      orderBy: { time: "asc" },
    }),
    prisma.client.findMany({
      where: { userId, movingDate: { gte: today, lt: tomorrow } },
      orderBy: { movingDate: "asc" },
    }),
    prisma.client.findMany({
      where: { userId, status: { in: ["EM_ATENDIMENTO", "ORCAMENTO_ENVIADO"] } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.task.findMany({
      where: { userId, done: false, date: { gte: today, lt: tomorrow } },
      include: { client: true },
      orderBy: { time: "asc" },
    }),
    prisma.task.findMany({
      where: { userId, done: false, date: { lt: today } },
      include: { client: true },
      orderBy: { date: "asc" },
    }),
    prisma.client.count({ where: { userId, status: "NOVO_CONTATO" } }),
    prisma.client.count({
      where: { userId, status: { in: ["EM_ATENDIMENTO", "ORCAMENTO_ENVIADO"] } },
    }),
    prisma.client.count({ where: { userId, status: "AGUARDANDO_CLIENTE" } }),
    prisma.client.count({ where: { userId, status: "FECHADO" } }),
  ]);

  return {
    retornosHoje,
    vistoriasHoje,
    followupsHoje,
    mudancasHoje,
    orcamentosPendentes,
    tarefasHoje,
    tarefasAtrasadas,
    indicators: {
      novosContatos,
      emAtendimento,
      aguardandoResposta,
      fechados,
    },
  };
}
