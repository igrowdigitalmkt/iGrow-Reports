import {
  BarChart3,
  CalendarRange,
  Clock3,
  FileText,
  Info,
} from "lucide-react";
import type { Metadata } from "next";
import { requireClientPortalAccess } from "@/modules/client-portal/context";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";

export const metadata: Metadata = {
  title: "Visão do cliente",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const unavailable = "Ainda não disponível";

export default async function ClientOverviewPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const { user, access, accesses } = await requireClientPortalAccess(clientId);
  const { client } = access;

  return (
    <ClientPortalShell
      title={client.name}
      description="Acompanhe os dados liberados pela agência em um único ambiente. Esta área usará a mesma base de métricas dos relatórios publicados."
      userEmail={user.email}
      showClientSwitcher={accesses.length > 1}
    >
      {client.archivedAt && (
        <div role="status" className="mb-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="mt-0.5 shrink-0" size={18} />
          <p>Este cliente está arquivado. O histórico continuará acessível conforme os relatórios e dados preservados pela agência.</p>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <PortalStatusCard icon={<CalendarRange size={19} />} label="Período consultado" value={unavailable} />
        <PortalStatusCard icon={<Clock3 size={19} />} label="Última atualização" value={unavailable} />
        <PortalStatusCard icon={<FileText size={19} />} label="Relatórios publicados" value={unavailable} />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <BarChart3 size={20} />
            </span>
            <div>
              <h2 className="font-semibold">Dados de desempenho</h2>
              <p className="mt-1 text-xs text-slate-500">Indicadores, comparações e evolução do período</p>
            </div>
          </div>
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
            <h3 className="text-sm font-semibold">Aguardando dados reais</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              Nenhum número de demonstração é exibido aqui. Quando a coleta da Meta e o motor de métricas estiverem habilitados, esta visão mostrará apenas dados realmente associados a este cliente.
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <FileText size={20} />
            </span>
            <div>
              <h2 className="font-semibold">Histórico de relatórios</h2>
              <p className="mt-1 text-xs text-slate-500">Versões publicadas para este cliente</p>
            </div>
          </div>
          <div className="mt-8 rounded-2xl bg-slate-50 p-5">
            <p className="text-sm font-medium text-slate-700">Nenhum relatório publicado</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              O módulo de relatórios ainda não foi habilitado neste ambiente. As versões aparecerão aqui sem depender de uma nova consulta à Meta para serem abertas.
            </p>
          </div>
        </div>
      </section>
    </ClientPortalShell>
  );
}

function PortalStatusCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">{icon}</span>
      <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}
