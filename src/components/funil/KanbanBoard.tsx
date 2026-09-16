"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { STATUS, STATUS_ORDER, StatusKey } from "@/lib/constants";
import { formatCurrency, formatDate, formatDateForLabel } from "@/lib/date";
import { updateClientStatus } from "@/app/actions/clients";

type Client = {
  id: string;
  name: string;
  originAddress: string | null;
  destinationAddress: string | null;
  movingDate: Date | null;
  budgetValue: number | null;
  awaitingBudget: boolean;
  nextTask: { title: string; date: Date; time: string | null } | null;
};

export default function KanbanBoard({
  columns,
}: {
  columns: Record<StatusKey, Client[]>;
}) {
  const [, startTransition] = useTransition();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<StatusKey | null>(null);

  function moveClient(clientId: string, status: StatusKey) {
    startTransition(() => {
      updateClientStatus(clientId, status);
    });
  }

  return (
    <>
      {/* Celular: lista agrupada por status (sem arrastar) */}
      <div className="md:hidden flex flex-col gap-5 pb-4">
        {STATUS_ORDER.map((key) => {
          const clients = columns[key];
          return (
            <div key={key}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-neutral-700 text-sm flex items-center gap-1.5">
                  <span>{STATUS[key].emoji}</span>
                  {STATUS[key].label}
                </h3>
                <span className="text-xs font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">
                  {clients.length}
                </span>
              </div>
              {clients.length === 0 ? (
                <p className="text-xs text-neutral-400 py-1">Nenhum cliente aqui.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {clients.map((c) => (
                    <ClientCard key={c.id} client={c} status={key} onMove={moveClient} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: kanban horizontal com arrastar */}
      <div className="hidden md:flex gap-4 overflow-x-auto h-full pb-4 -mx-1 px-1 snap-x">
        {STATUS_ORDER.map((key) => {
          const clients = columns[key];
          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverColumn(key);
              }}
              onDragLeave={() => setDragOverColumn((c) => (c === key ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/client-id");
                if (id) moveClient(id, key);
                setDraggingId(null);
                setDragOverColumn(null);
              }}
              className={`flex flex-col w-72 shrink-0 snap-start rounded-2xl border bg-neutral-50/80 ${
                dragOverColumn === key ? "border-orange-400 bg-orange-50/60" : "border-neutral-200"
              }`}
            >
              <div className="px-3.5 pt-3.5 pb-2 flex items-center justify-between">
                <h3 className="font-semibold text-neutral-700 text-sm flex items-center gap-1.5">
                  <span>{STATUS[key].emoji}</span>
                  {STATUS[key].label}
                </h3>
                <span className="text-xs font-bold text-neutral-400 bg-white rounded-full px-2 py-0.5">
                  {clients.length}
                </span>
              </div>

              <div className="flex flex-col gap-2 px-2.5 pb-3 overflow-y-auto">
                {clients.length === 0 && (
                  <p className="text-xs text-neutral-400 px-1.5 py-2">Nenhum cliente aqui.</p>
                )}
                {clients.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/client-id", c.id);
                      setDraggingId(c.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    className={`cursor-grab active:cursor-grabbing ${
                      draggingId === c.id ? "opacity-40" : ""
                    }`}
                  >
                    <ClientCard client={c} status={key} onMove={moveClient} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ClientCard({
  client: c,
  status,
  onMove,
}: {
  client: Client;
  status: StatusKey;
  onMove: (clientId: string, status: StatusKey) => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <Link href={`/clientes/${c.id}`} className="block mb-2">
        <p className="font-semibold text-neutral-900 leading-tight">{c.name}</p>
        {c.awaitingBudget && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5 mt-1">
            ⏳ Só falta o orçamento
          </span>
        )}
        {(c.originAddress || c.destinationAddress) && (
          <p className="text-xs text-neutral-500 mt-0.5 truncate">
            {c.originAddress ?? "?"} → {c.destinationAddress ?? "?"}
          </p>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-neutral-500">
            {c.movingDate ? formatDate(c.movingDate) : "Sem data"}
          </span>
          <span className="text-xs font-semibold text-neutral-700">
            {c.budgetValue ? formatCurrency(c.budgetValue) : "—"}
          </span>
        </div>
        {c.nextTask && (
          <p className="text-xs text-orange-700 bg-orange-50 rounded-lg px-2 py-1 mt-2 truncate">
            📌 {c.nextTask.title} — {formatDateForLabel(c.nextTask.date)}
          </p>
        )}
      </Link>
      <select
        value={status}
        onChange={(e) => onMove(c.id, e.target.value as StatusKey)}
        className="w-full text-base font-medium rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5"
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS[s].emoji} {STATUS[s].label}
          </option>
        ))}
      </select>
    </div>
  );
}
