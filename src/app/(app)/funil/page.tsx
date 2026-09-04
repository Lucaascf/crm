import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import KanbanBoard from "@/components/funil/KanbanBoard";
import { STATUS_ORDER, StatusKey } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function FunilPage() {
  const userId = requireUserId();
  const [clients, pendingTasks] = await Promise.all([
    prisma.client.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
    prisma.task.findMany({
      where: { userId, done: false },
      orderBy: { date: "asc" },
    }),
  ]);

  const nextTaskByClient = new Map<string, (typeof pendingTasks)[number]>();
  for (const task of pendingTasks) {
    if (task.clientId && !nextTaskByClient.has(task.clientId)) {
      nextTaskByClient.set(task.clientId, task);
    }
  }

  const columns = STATUS_ORDER.reduce((acc, key) => {
    acc[key] = clients
      .filter((c) => c.status === key)
      .map((c) => ({
        ...c,
        nextTask: nextTaskByClient.get(c.id) ?? null,
      }));
    return acc;
  }, {} as Record<StatusKey, ((typeof clients)[number] & { nextTask: (typeof pendingTasks)[number] | null })[]>);

  return (
    <div className="pb-8 md:h-full flex flex-col">
      <PageHeader
        title="Funil"
        subtitle="No celular, use o menu de status de cada cliente. No computador, arraste o cartão."
      />
      <div className="md:flex-1 md:min-h-0 px-4 md:px-8">
        <KanbanBoard columns={columns} />
      </div>
    </div>
  );
}
