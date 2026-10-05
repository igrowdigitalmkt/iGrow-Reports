import Link from "next/link";
import "./snapshot-dashboard.css";

export function SnapshotUnavailable({ clientId }: { clientId: string }) {
  return <section className="snapshot-dashboard" aria-label="Análise confirmada">
    <div className="snapshot-status" role="status">
      <h2>Análise confirmada temporariamente indisponível</h2>
      <p>Estamos concluindo a configuração desta análise. Você pode continuar acompanhando seus dados no dashboard.</p>
      <Link className="snapshot-link" href={`/cliente/${clientId}`}>Voltar ao dashboard</Link>
    </div>
  </section>;
}
