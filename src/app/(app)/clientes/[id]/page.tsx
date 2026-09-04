import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { formatDateTime, formatDateForLabel } from "@/lib/date";
import { addHistoryEntry } from "@/app/actions/clients";
import { createTask } from "@/app/actions/tasks";
import StatusPicker from "@/components/client/StatusPicker";
import EditableInfo from "@/components/client/EditableInfo";
import TaskCheckbox from "@/components/TaskCheckbox";
import { inputClass } from "@/lib/formStyles";

export const dynamic = "force-dynamic";

function waLink(whatsapp: string) {
  const digits = whatsapp.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

export default async function ClienteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const userId = requireUserId();
  const client = await prisma.client.findFirst({
    where: { id: params.id, userId },
    include: {
      historyEntries: { orderBy: { createdAt: "desc" } },
      tasks: { orderBy: [{ done: "asc" }, { date: "asc" }] },
    },
  });

  if (!client) notFound();

  const addHistory = addHistoryEntry.bind(null, client.id);

  return (
    <div className="pb-24 md:pb-8">
      <div className="px-4 pt-6 pb-2 md:px-8 md:pt-8">
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 mb-3"
        >
          <ChevronLeft size={16} />
          Clientes
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">{client.name}</h1>
            <a
              href={waLink(client.whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-emerald-700 font-medium mt-1 hover:underline"
            >
              <MessageCircle size={16} />
              {client.whatsapp}
            </a>
          </div>
          <StatusPicker clientId={client.id} status={client.status} />
        </div>
      </div>

      <div className="px-4 md:px-8 mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <div className="md:col-span-2 flex flex-col gap-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
            <EditableInfo client={client} />
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">
              Histórico
            </p>
            <form action={addHistory} className="flex gap-2 mb-4">
              <input
                name="text"
                required
                placeholder="Registrar um acontecimento..."
                className={inputClass}
              />
              <button
                type="submit"
                className="shrink-0 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold rounded-xl px-4 py-2.5"
              >
                Adicionar
              </button>
            </form>
            {client.historyEntries.length === 0 ? (
              <p className="text-sm text-neutral-400">Nenhum registro ainda.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {client.historyEntries.map((h) => (
                  <li key={h.id} className="flex gap-3">
                    <span className="text-xs font-semibold text-neutral-400 shrink-0 pt-0.5 w-24">
                      {formatDateTime(h.createdAt)}
                    </span>
                    <span className="text-[15px] text-neutral-700">{h.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
          <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">
            Tarefas deste cliente
          </p>
          <form action={createTask} className="flex flex-col gap-2 mb-4">
            <input type="hidden" name="clientId" value={client.id} />
            <input
              name="title"
              required
              placeholder="Ex: Enviar orçamento"
              className={inputClass}
            />
            <div className="flex gap-2">
              <input type="date" name="date" required className={inputClass} />
              <input type="time" name="time" className={inputClass} />
            </div>
            <button
              type="submit"
              className="bg-neutral-900 hover:bg-neutral-800 text-white font-semibold rounded-xl px-4 py-2.5"
            >
              Adicionar tarefa
            </button>
          </form>
          {client.tasks.length === 0 ? (
            <p className="text-sm text-neutral-400">Nenhuma tarefa para este cliente.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {client.tasks.map((t) => (
                <li
                  key={t.id}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${
                    t.done ? "bg-neutral-50" : "bg-orange-50"
                  }`}
                >
                  <TaskCheckbox id={t.id} done={t.done} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-medium truncate ${
                        t.done ? "text-neutral-400 line-through" : "text-neutral-800"
                      }`}
                    >
                      {t.title}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatDateForLabel(t.date)}
                      {t.time ? ` — ${t.time}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
