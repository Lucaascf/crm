import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { todayStart, formatDateForLabel } from "@/lib/date";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import NewAppointmentForm from "@/components/agenda/NewAppointmentForm";
import DeleteAppointmentButton from "@/components/agenda/DeleteAppointmentButton";
import StatusBadge from "@/components/StatusBadge";
import { APPOINTMENT_TYPE, APPOINTMENT_TYPE_ORDER, AppointmentTypeKey } from "@/lib/constants";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const userId = requireUserId();
  const today = todayStart();
  const typeFilter = searchParams.type as AppointmentTypeKey | undefined;

  const [appointments, clients] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        userId,
        date: { gte: today },
        ...(typeFilter ? { type: typeFilter } : {}),
      },
      include: { client: true },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    }),
    prisma.client.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const groups = new Map<string, typeof appointments>();
  for (const a of appointments) {
    const label = formatDateForLabel(a.date);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(a);
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Agenda"
        subtitle="Vistorias, mudanças, retornos e follow-ups"
        action={<div className="hidden md:block"><NewAppointmentForm clients={clients} /></div>}
      />

      <div className="px-4 md:px-8 flex flex-col gap-6">
        <div className="md:hidden">
          <NewAppointmentForm clients={clients} />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <FilterChip href="/agenda" active={!typeFilter}>
            Todos
          </FilterChip>
          {APPOINTMENT_TYPE_ORDER.map((t) => (
            <FilterChip key={t} href={`/agenda?type=${t}`} active={typeFilter === t}>
              {APPOINTMENT_TYPE[t].emoji} {APPOINTMENT_TYPE[t].label}
            </FilterChip>
          ))}
        </div>

        {appointments.length === 0 ? (
          <EmptyState
            emoji="📅"
            title={typeFilter ? "Nenhum compromisso encontrado" : "Nenhum compromisso marcado"}
            subtitle={
              typeFilter
                ? "Tente outro filtro ou cadastre um novo compromisso."
                : "Cadastre vistorias, retornos, follow-ups e mudanças aqui."
            }
          />
        ) : (
          Array.from(groups.entries()).map(([label, items]) => {
            const isToday = label === "Hoje";
            return (
              <div key={label}>
                <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wide mb-2 capitalize">
                  {label}
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((a) => (
                    <li
                      key={a.id}
                      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
                        isToday
                          ? "border-orange-200 bg-orange-50"
                          : "border-neutral-200 bg-white"
                      }`}
                    >
                      <span className="text-xl shrink-0">{APPOINTMENT_TYPE[a.type as keyof typeof APPOINTMENT_TYPE]?.emoji ?? "📌"}</span>
                      <div className="min-w-0 flex-1">
                        {a.client ? (
                          <Link href={`/clientes/${a.client.id}`} className="font-semibold text-neutral-900 hover:underline">
                            {a.title}
                          </Link>
                        ) : (
                          <p className="font-semibold text-neutral-900">{a.title}</p>
                        )}
                        <p className="text-xs text-neutral-500">
                          {APPOINTMENT_TYPE[a.type as keyof typeof APPOINTMENT_TYPE]?.label}
                          {a.client ? ` · ${a.client.name}` : ""}
                          {a.notes ? ` · ${a.notes}` : ""}
                        </p>
                        <div className="flex items-center flex-wrap gap-2 mt-2">
                          {a.client && <StatusBadge status={a.client.status} />}
                          {a.time && (
                            <span className="text-sm font-semibold text-neutral-600">{a.time}</span>
                          )}
                        </div>
                      </div>
                      <DeleteAppointmentButton id={a.id} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
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
