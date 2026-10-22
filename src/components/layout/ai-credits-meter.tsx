import { formatCredits, type AiCreditsView } from "@/modules/ai/credits";

/** Duas moedas entrelaçadas, o ícone de créditos. */
const CreditsIcon = () => <svg className="credits-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <circle cx="9" cy="14.5" r="5.5" /><circle cx="15" cy="9.5" r="5.5" />
</svg>;

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Contador de créditos de IA do mês, no rodapé do menu lateral (visível a todos os membros). */
export function AiCreditsMeter({ credits }: { credits: AiCreditsView }) {
  const title = `Créditos de IA: ${formatCredits(credits.used)} de ${formatCredits(credits.limit)} usados neste mês`;
  return <div className={`credits-card is-${credits.level}`} data-tip={title} role="group" aria-label={title}>
    <CreditsIcon />
    <div className="credits-body collapse-hide">
      <div className="credits-head"><span>Créditos de IA</span><strong>{credits.percent}%</strong></div>
      <div className="credits-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={credits.percent} aria-label="Consumo de créditos de IA no mês"><span style={{ width: `${credits.percent}%` }} /></div>
      <small>{formatCredits(credits.used)} de {formatCredits(credits.limit)} neste mês</small>
      <small>{credits.level === "exhausted" ? "Créditos esgotados · " : ""}Renova em {day(credits.resetsOn)}</small>
    </div>
  </div>;
}
