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
      description="Acompanhe indicadores, períodos e relatórios liberados pela agência em um único ambiente."
      userEmail={user.email}
      showClientSwitcher={accesses.length > 1}
    >
      {client.archivedAt && (
        <div role="status" className="client-alert">
          <Info size={16} />
          <p>Este cliente está arquivado. O histórico continuará acessível conforme os dados preservados pela agência.</p>
        </div>
      )}

      <section className="client-status-grid">
        <PortalStatusCard icon={<CalendarRange size={16} />} label="Período consultado" value={unavailable} />
        <PortalStatusCard icon={<Clock3 size={16} />} label="Última atualização" value={unavailable} />
        <PortalStatusCard icon={<FileText size={16} />} label="Relatórios publicados" value={unavailable} />
      </section>
      <section className="client-dashboard-grid">
        <div className="client-panel client-performance-panel">
          <div className="client-panel-heading">
            <span className="client-panel-icon"><BarChart3 size={17} /></span>
            <div>
              <h2>Dados de desempenho</h2>
              <p>Indicadores, comparações e evolução do período</p>
            </div>
          </div>
          <div className="client-empty">
            <h3>Aguardando dados reais</h3>
            <p>
              Nenhum número de demonstração é exibido aqui. Quando a coleta da Meta e o motor de métricas estiverem habilitados, esta visão mostrará somente dados associados a este cliente.
            </p>
          </div>
        </div>

        <div className="client-panel">
          <div className="client-panel-heading">
            <span className="client-panel-icon"><FileText size={17} /></span>
            <div>
              <h2>Histórico de relatórios</h2>
              <p>Versões publicadas para este cliente</p>
            </div>
          </div>
          <div className="client-report-empty">
            <strong>Nenhum relatório publicado</strong>
            <p>
              As versões aprovadas aparecerão aqui assim que o módulo de relatórios estiver habilitado.
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
    <div className="client-status-card">
      <span className="client-status-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
