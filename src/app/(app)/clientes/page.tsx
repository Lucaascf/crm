import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/date";
import StatusBadge from "@/components/StatusBadge";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { STATUS, STATUS_ORDER } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const userId = requireUserId();
  const q = (searchParams.q ?? "").trim();
  const statusFilter = (searchParams.status ?? "")
    .split(",")
    .filter(Boolean);

  const clients = await prisma.client.findMany({
    where: {
      userId,
      AND: [
        q
          ? {
              OR: [
                { name: { contains: q } },
                { whatsapp: { contains: q } },
              ],
            }
          : {},
        statusFilter.length > 0 ? { status: { in: statusFilter } } : {},
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="pb-8">
      <PageHeader
        title="Clientes"
        subtitle={`${clients.length} ${clients.length === 1 ? "cliente" : "clientes"}`}
        action={
          <Link
            href="/clientes/novo"
            className="hidden md:flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-2.5 shadow-sm"
          >
            <Plus size={18} />
            Novo cliente
          </Link>
        }
      />

      <div className="px-4 md:px-8 flex flex-col gap-4">
        <form className="flex gap-2" action="/clientes">
          <div className="relative flex-1">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nome ou WhatsApp..."
              className="w-full rounded-xl border border-neutral-300 bg-white pl-10 pr-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          {statusFilter.length > 0 && (
            <input type="hidden" name="status" value={statusFilter.join(",")} />
          )}
          <button
            type="submit"
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-600 hover:bg-neutral-50"
          >
            Buscar
          </button>
        </form>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <FilterChip href="/clientes" active={statusFilter.length === 0}>
            Todos
          </FilterChip>
          {STATUS_ORDER.map((key) => (
            <FilterChip
              key={key}
              href={`/clientes?status=${key}`}
              active={statusFilter.length === 1 && statusFilter[0] === key}
            >
              {STATUS[key].emoji} {STATUS[key].label}
            </FilterChip>
          ))}
        </div>

        {clients.length === 0 ? (
          <EmptyState
            emoji="👥"
            title={q || statusFilter.length ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado ainda"}
            subtitle={
              q || statusFilter.length
                ? "Tente buscar por outro nome ou limpar o filtro."
                : "Cadastre o primeiro cliente para começar a usar o painel."
            }
            action={
              !q && !statusFilter.length ? (
                <Link
                  href="/clientes/novo"
                  className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-2.5"
                >
                  <Plus size={18} />
                  Novo cliente
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {clients.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clientes/${c.id}`}
                  className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 hover:border-orange-300 hover:shadow-sm transition-all"
                >
                  <div className="md:w-48 shrink-0">
                    <p className="font-semibold text-neutral-900">{c.name}</p>
                    <p className="text-sm text-neutral-500">{c.whatsapp}</p>
                  </div>
                  <div className="flex-1 min-w-0 text-sm text-neutral-600">
                    {c.originAddress || c.destinationAddress ? (
                      <p className="truncate">
                        {c.originAddress ?? "?"} → {c.destinationAddress ?? "?"}
                      </p>
                    ) : (
                      <p className="text-neutral-400">Endereços não informados</p>
                    )}
                    <p className="text-neutral-400">
                      {c.movingDate ? `Mudança em ${formatDate(c.movingDate)}` : "Sem data de mudança"}
                    </p>
                  </div>
                  <div className="md:w-32 shrink-0 font-semibold text-neutral-800">
                    {c.budgetValue ? formatCurrency(c.budgetValue) : "—"}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {c.awaitingBudget && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                        ⏳ Só falta o orçamento
                      </span>
                    )}
                    <StatusBadge status={c.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        href="/clientes/novo"
        className="md:hidden fixed bottom-20 right-4 z-40 flex items-center gap-2 bg-orange-600 text-white font-semibold rounded-full pl-4 pr-5 py-3 shadow-lg shadow-orange-600/30"
      >
        <Plus size={20} />
        Novo cliente
      </Link>
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
        active
          ? "bg-neutral-900 border-neutral-900 text-white"
          : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {children}
    </Link>
  );
}
