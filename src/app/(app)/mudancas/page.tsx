import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { formatDateForLabel, formatDate, todayStart } from "@/lib/date";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function MudancasPage() {
  const userId = requireUserId();
  const today = todayStart();

  const [upcoming, past] = await Promise.all([
    prisma.client.findMany({
      where: { userId, movingDate: { gte: today } },
      orderBy: { movingDate: "asc" },
    }),
    prisma.client.findMany({
      where: { userId, movingDate: { lt: today } },
      orderBy: { movingDate: "desc" },
      take: 15,
    }),
  ]);

  const groups = new Map<string, typeof upcoming>();
  for (const c of upcoming) {
    const label = formatDateForLabel(c.movingDate!);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(c);
  }

  return (
    <div className="pb-8">
      <PageHeader title="Mudanças" subtitle="Todas as mudanças confirmadas" />

      <div className="px-4 md:px-8 flex flex-col gap-6">
        {upcoming.length === 0 ? (
          <EmptyState
            emoji="🚚"
            title="Nenhuma mudança marcada"
            subtitle="As mudanças aparecem aqui assim que você define a data no cadastro do cliente."
          />
        ) : (
          Array.from(groups.entries()).map(([label, items]) => (
            <div key={label}>
              <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wide mb-2 capitalize">
                {label}
              </h2>
              <ul className="flex flex-col gap-2">
                {items.map((c) => (
                  <MoveCard key={c.id} client={c} />
                ))}
              </ul>
            </div>
          ))
        )}

        {past.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wide mb-2">
              Mudanças anteriores
            </h2>
            <ul className="flex flex-col gap-2">
              {past.map((c) => (
                <MoveCard key={c.id} client={c} muted />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function MoveCard({
  client: c,
  muted,
}: {
  client: {
    id: string;
    name: string;
    originAddress: string | null;
    destinationAddress: string | null;
    movingDate: Date | null;
    movingNotes: string | null;
    status: string;
  };
  muted?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/clientes/${c.id}`}
        className={`flex flex-col gap-2 rounded-2xl border px-4 py-3.5 hover:border-orange-300 hover:shadow-sm transition-all ${
          muted ? "border-neutral-100 bg-neutral-50" : "border-neutral-200 bg-white"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-neutral-900">{c.name}</p>
            <p className="text-sm text-neutral-600">
              {c.originAddress ?? "?"} → {c.destinationAddress ?? "?"}
            </p>
          </div>
          <StatusBadge status={c.status} />
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <span>📅 {c.movingDate ? formatDate(c.movingDate) : "—"}</span>
        </div>
        {c.movingNotes && <p className="text-sm text-neutral-500">{c.movingNotes}</p>}
      </Link>
    </li>
  );
}
