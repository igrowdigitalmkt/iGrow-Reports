import { RefreshCw } from "lucide-react";
import "@/modules/client-portal/analytics-dashboard.css";

export default function ClientOverviewLoading() {
  return <main className="client-portal-shell client-portal-dark">
    <section className="analytics-dashboard analytics-route-loading" aria-label="Carregando painel de desempenho" aria-busy="true">
      <div className="analytics-loading-panel">
        <RefreshCw size={20} className="analytics-spin" />
        <div>
          <span className="analytics-eyebrow">CARREGANDO DADOS</span>
          <h2>Atualizando a visualização.</h2>
          <p>Estamos buscando o período selecionado. Os números anteriores voltam a aparecer só se esta consulta não puder ser concluída.</p>
        </div>
      </div>
      <div className="analytics-loading-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
      </div>
    </section>
  </main>;
}
