import { Send } from "lucide-react";
import type { ReportDeliveryStatus } from "@/types/database";

export type DeliveryItem = {
  id: string; createdAt: string; statusAt: string; status: ReportDeliveryStatus; errorMessage: string | null; errorCode: string | null;
  clientName: string; recipientName: string; recipientPhone: string; reportTitle: string; period: string | null;
};

const STATUS: Record<ReportDeliveryStatus, { label: string; tone: string }> = {
  pending: { label: "Na fila", tone: "neutral" },
  sending: { label: "Enviando", tone: "neutral" },
  accepted: { label: "Aceito pelo WhatsApp", tone: "blue" },
  sent: { label: "Enviado", tone: "blue" },
  delivered: { label: "Entregue", tone: "green" },
  read: { label: "Lido", tone: "green" },
  failed: { label: "Falhou", tone: "amber" },
  uncertain: { label: "Sem confirmação", tone: "amber" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

// Most common WhatsApp Cloud API failures, in plain language with the action to take.
const ERRORS: Record<string, string> = {
  "131042": "A conta do WhatsApp está sem forma de pagamento válida. Configure o pagamento no Gerenciador do WhatsApp.",
  "131026": "O número não pôde receber a mensagem (sem WhatsApp, bloqueado ou versão antiga).",
  "131047": "Fora da janela de 24 horas: é preciso usar uma mensagem modelo aprovada.",
  "131049": "A Meta limitou envios para este destinatário. Tente mais tarde.",
  "131051": "Tipo de mensagem não suportado.",
  "131053": "Não foi possível enviar o arquivo PDF.",
  "132000": "As variáveis não correspondem à mensagem modelo.",
  "132001": "A mensagem modelo não existe ou não está aprovada neste idioma.",
  "133010": "O número de envio não está registrado na API.",
  "368": "A conta foi restringida por violar políticas do WhatsApp.",
};
export const deliveryErrorText = (code: string | null, message: string | null) => (code && ERRORS[code]) || message;

const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));

// History of reports sent by WhatsApp, with the latest status reported by Meta.
export function DeliveriesView({ deliveries, connected }: { deliveries: DeliveryItem[]; connected: boolean }) {
  const delivered = deliveries.filter(item => item.status === "delivered" || item.status === "read").length;
  const read = deliveries.filter(item => item.status === "read").length;
  const failed = deliveries.filter(item => item.status === "failed" || item.status === "uncertain").length;
  if (!deliveries.length) return <section className="panel empty-state"><Send size={22} /><h3>Nenhum envio ainda</h3><p>{connected ? "Envie um relatório em Relatórios › Enviar por WhatsApp. Cada envio aparece aqui com entrega e leitura." : "Conecte o WhatsApp em Integrações para enviar os relatórios por mensagem."}</p></section>;
  return <>
    <div className="stats-grid">
      <section className="panel metric-card"><div className="metric-label"><span>Envios</span></div><strong className="metric-value">{deliveries.length}</strong><div className="metric-foot"><span>últimos registros</span></div></section>
      <section className="panel metric-card"><div className="metric-label"><span>Entregues</span></div><strong className="metric-value">{delivered}</strong><div className="metric-foot"><span>confirmados pelo WhatsApp</span></div></section>
      <section className="panel metric-card"><div className="metric-label"><span>Lidos</span></div><strong className="metric-value">{read}</strong><div className="metric-foot"><span>quando o destinatário permite confirmação</span></div></section>
      <section className="panel metric-card"><div className="metric-label"><span>Com problema</span></div><strong className="metric-value">{failed}</strong><div className="metric-foot"><span>falhas ou sem confirmação</span></div></section>
    </div>
    <section className="panel" style={{ overflow: "hidden" }}><div className="table-scroll"><table className="data-table">
      <caption className="sr-only">Relatórios enviados por WhatsApp</caption>
      <thead><tr><th scope="col">Enviado em</th><th scope="col">Cliente</th><th scope="col">Destinatário</th><th scope="col">Relatório</th><th scope="col">Situação</th></tr></thead>
      <tbody>{deliveries.map(item => <tr key={item.id}>
        <td className="mono-date">{dateTime(item.createdAt)}</td>
        <td>{item.clientName}</td>
        <td><div className="client-cell"><span style={{ minWidth: 0 }}><strong>{item.recipientName}</strong><small>{item.recipientPhone}</small></span></div></td>
        <td><div className="client-cell"><span style={{ minWidth: 0 }}><strong>{item.reportTitle}</strong>{item.period && <small>{item.period}</small>}</span></div></td>
        <td><span className={`badge ${STATUS[item.status].tone}`}><span className="status-dot" />{STATUS[item.status].label}</span>{item.errorMessage && <small className="delivery-error" title={`${item.errorCode ? `Código ${item.errorCode}: ` : ""}${item.errorMessage}`}>{deliveryErrorText(item.errorCode, item.errorMessage)}</small>}<small className="delivery-time">atualizado {dateTime(item.statusAt)}</small></td>
      </tr>)}</tbody>
    </table></div></section>
  </>;
}
