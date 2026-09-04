import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { formatDateForLabel, todayStart, startOfDay, isSameDay } from "@/lib/date";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import NewTaskForm from "@/components/tarefas/NewTaskForm";
import TaskCheckbox from "@/components/TaskCheckbox";

export const dynamic = "force-dynamic";

export default async function TarefasPage() {
  const userId = requireUserId();
  const [pending, done, clients] = await Promise.all([
    prisma.task.findMany({
      where: { userId, done: false },
      include: { client: true },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    }),
    prisma.task.findMany({
      where: { userId, done: true },
      include: { client: true },
      orderBy: { date: "desc" },
      take: 20,
    }),
    prisma.client.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const today = todayStart();
  const overdueTasks = pending.filter((t) => startOfDay(t.date) < today);
  const todayTasks = pending.filter((t) => isSameDay(t.date, today));
  const upcomingTasks = pending.filter((t) => startOfDay(t.date) > today);

  function renderTask(t: (typeof pending)[number], overdue: boolean) {
    return (
      <li
        key={t.id}
        className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
          overdue ? "border-rose-200 bg-rose-50" : "border-neutral-200 bg-white"
        }`}
      >
        <div className="pt-0.5 shrink-0">
          <TaskCheckbox id={t.id} done={t.done} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-neutral-800">{t.title}</p>
          <p className="text-xs text-neutral-500">
            {t.client ? (
              <Link href={`/clientes/${t.client.id}`} className="hover:underline">
                {t.client.name}
              </Link>
            ) : null}
            {t.notes ? (t.client ? ` · ${t.notes}` : t.notes) : ""}
          </p>
          <p
            className={`text-xs font-semibold mt-1 ${
              overdue ? "text-rose-600" : "text-neutral-500"
            }`}
          >
            {overdue ? "Atrasada — " : ""}
            {formatDateForLabel(t.date)}
            {t.time ? ` — ${t.time}` : ""}
          </p>
        </div>
      </li>
    );
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Tarefas"
        subtitle={`${pending.length} ${pending.length === 1 ? "pendente" : "pendentes"}`}
        action={<div className="hidden md:block"><NewTaskForm clients={clients} /></div>}
      />

      <div className="px-4 md:px-8 flex flex-col gap-6">
        <div className="md:hidden">
          <NewTaskForm clients={clients} />
        </div>

        {pending.length === 0 ? (
          <EmptyState emoji="✅" title="Nenhuma tarefa pendente" subtitle="Você está em dia!" />
        ) : (
          <>
            {overdueTasks.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-rose-600 uppercase tracking-wide mb-2">
                  ⚠️ Atrasadas
                </h2>
                <ul className="flex flex-col gap-2">
                  {overdueTasks.map((t) => renderTask(t, true))}
                </ul>
              </div>
            )}

            {todayTasks.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wide mb-2">
                  Hoje
                </h2>
                <ul className="flex flex-col gap-2">
                  {todayTasks.map((t) => renderTask(t, false))}
                </ul>
              </div>
            )}

            {upcomingTasks.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wide mb-2">
                  Futuras
                </h2>
                <ul className="flex flex-col gap-2">
                  {upcomingTasks.map((t) => renderTask(t, false))}
                </ul>
              </div>
            )}
          </>
        )}

        {done.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wide mb-2">
              Concluídas recentemente
            </h2>
            <ul className="flex flex-col gap-2">
              {done.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start gap-3 rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-3"
                >
                  <div className="pt-0.5 shrink-0">
                    <TaskCheckbox id={t.id} done={t.done} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-neutral-400 line-through">{t.title}</p>
                    {t.client && <p className="text-xs text-neutral-400 truncate">{t.client.name}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
