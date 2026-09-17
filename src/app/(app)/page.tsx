import Link from "next/link";
import { Plus } from "lucide-react";
import { getDashboardData } from "@/lib/dashboard";
import { requireUserId } from "@/lib/auth";
import { formatDateLong, formatCurrency, formatDate } from "@/lib/date";
import IndicatorTile from "@/components/dashboard/IndicatorTile";
import TodaySection from "@/components/dashboard/TodaySection";
import TodayItem from "@/components/dashboard/TodayItem";
import TaskCheckbox from "@/components/TaskCheckbox";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = requireUserId();
  const data = await getDashboardData(userId);
  const today = new Date();

  const totalHoje =
    data.retornosHoje.length +
    data.vistoriasHoje.length +
    data.followupsHoje.length +
    data.mudancasHoje.length;

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-2 md:px-8 md:pt-8">
        <p className="text-neutral-500 capitalize">{formatDateLong(today)}</p>
        <h1 className="text-2xl font-bold text-neutral-900 mt-0.5">
          {totalHoje === 0
            ? "Nenhum compromisso marcado para hoje"
            : "O que precisa da sua atenção hoje"}
        </h1>
      </div>

      <div className="px-4 md:px-8 mt-4 flex flex-col gap-6">
        {/* Tarefas atrasadas */}
        {data.tarefasAtrasadas.length > 0 && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <h3 className="font-semibold text-rose-900 mb-3 flex items-center gap-2">
              ⚠️ Tarefas atrasadas
              <span className="text-xs font-bold bg-white text-rose-700 rounded-full px-2 py-0.5">
                {data.tarefasAtrasadas.length}
              </span>
            </h3>
            <ul className="flex flex-col gap-2">
              {data.tarefasAtrasadas.map((t) => (
                <li key={t.id} className="flex items-start gap-3 bg-white rounded-xl px-3 py-2.5">
                  <div className="pt-0.5 shrink-0">
                    <TaskCheckbox id={t.id} done={t.done} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-neutral-800">{t.title}</p>
                    {t.client && (
                      <p className="text-xs text-neutral-500 truncate">{t.client.name}</p>
                    )}
                    <p className="text-xs font-semibold text-rose-600 mt-1">
                      {formatDate(t.date)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tarefas pendentes de hoje */}
        {data.tarefasHoje.length > 0 && (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <h3 className="font-semibold text-orange-900 mb-3 flex items-center gap-2">
              ✅ Suas tarefas de hoje
              <span className="text-xs font-bold bg-white text-orange-700 rounded-full px-2 py-0.5">
                {data.tarefasHoje.length}
              </span>
            </h3>
            <ul className="flex flex-col gap-2">
              {data.tarefasHoje.map((t) => (
                <li key={t.id} className="flex items-start gap-3 bg-white rounded-xl px-3 py-2.5">
                  <div className="pt-0.5 shrink-0">
                    <TaskCheckbox id={t.id} done={t.done} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-neutral-800">{t.title}</p>
                    {t.client && (
                      <p className="text-xs text-neutral-500 truncate">{t.client.name}</p>
                    )}
                    {t.time && (
                      <p className="text-xs font-semibold text-neutral-500 mt-1">{t.time}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Grade de seções do dia */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TodaySection
            emoji="📞"
            title="Retornos"
            count={data.retornosHoje.length}
            emptyText="Nenhum retorno marcado para hoje."
            seeAllHref="/agenda"
          >
            {data.retornosHoje.map((a) => (
              <TodayItem
                key={a.id}
                href={a.client ? `/clientes/${a.client.id}` : "/agenda"}
                title={a.client?.name ?? a.title}
                subtitle={a.notes ?? undefined}
                time={a.time}
              />
            ))}
          </TodaySection>

          <TodaySection
            emoji="🏠"
            title="Vistorias"
            count={data.vistoriasHoje.length}
            emptyText="Nenhuma vistoria marcada para hoje."
            seeAllHref="/agenda"
          >
            {data.vistoriasHoje.map((a) => (
              <TodayItem
                key={a.id}
                href={a.client ? `/clientes/${a.client.id}` : "/agenda"}
                title={a.client?.name ?? a.title}
                subtitle={a.notes ?? undefined}
                time={a.time}
              />
            ))}
          </TodaySection>

          <TodaySection
            emoji="📋"
            title="Orçamentos"
            count={data.orcamentosPendentes.length}
            emptyText="Nenhum orçamento para enviar ou acompanhar."
            seeAllHref="/clientes"
          >
            {data.orcamentosPendentes.map((c) => (
              <TodayItem
                key={c.id}
                href={`/clientes/${c.id}`}
                title={c.name}
                subtitle={
                  c.budgetValue
                    ? `Orçamento: ${formatCurrency(c.budgetValue)}`
                    : c.awaitingBudget
                      ? "⏳ Só falta o orçamento"
                      : "Ainda em atendimento"
                }
              />
            ))}
          </TodaySection>

          <TodaySection
            emoji="🔄"
            title="Follow-ups"
            count={data.followupsHoje.length}
            emptyText="Nenhum follow-up marcado para hoje."
            seeAllHref="/agenda"
          >
            {data.followupsHoje.map((a) => (
              <TodayItem
                key={a.id}
                href={a.client ? `/clientes/${a.client.id}` : "/agenda"}
                title={a.client?.name ?? a.title}
                subtitle={a.notes ?? undefined}
                time={a.time}
              />
            ))}
          </TodaySection>

          <TodaySection
            emoji="🚚"
            title="Mudanças"
            count={data.mudancasHoje.length}
            emptyText="Nenhuma mudança marcada para hoje."
            seeAllHref="/mudancas"
          >
            {data.mudancasHoje.map((c) => (
              <TodayItem
                key={c.id}
                href={`/clientes/${c.id}`}
                title={c.name}
                subtitle={`${c.originAddress ?? "?"} → ${c.destinationAddress ?? "?"}`}
              />
            ))}
          </TodaySection>
        </div>

        {/* Indicadores gerais */}
        <div>
          <h2 className="text-sm font-semibold text-neutral-500 mb-3 uppercase tracking-wide">
            Visão geral
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <IndicatorTile
              href="/clientes?status=NOVO_CONTATO"
              value={data.indicators.novosContatos}
              label="Novos contatos"
              color="text-sky-600"
            />
            <IndicatorTile
              href="/clientes?status=EM_ATENDIMENTO,ORCAMENTO_ENVIADO"
              value={data.indicators.emAtendimento}
              label="Em atendimento"
              color="text-indigo-600"
            />
            <IndicatorTile
              href="/clientes?status=AGUARDANDO_CLIENTE"
              value={data.indicators.aguardandoResposta}
              label="Aguardando resposta"
              color="text-orange-600"
            />
            <IndicatorTile
              href="/clientes?status=FECHADO"
              value={data.indicators.fechados}
              label="Fechados"
              color="text-emerald-600"
            />
          </div>
        </div>

        <Link
          href="/clientes/novo"
          className="md:hidden fixed bottom-20 right-4 z-40 flex items-center gap-2 bg-orange-600 text-white font-semibold rounded-full pl-4 pr-5 py-3 shadow-lg shadow-orange-600/30"
        >
          <Plus size={20} />
          Novo cliente
        </Link>
      </div>
    </div>
  );
}
