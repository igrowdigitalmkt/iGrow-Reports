import { formatCredits, type AiCreditsView } from "@/modules/ai/credits";

/** Duas moedas entrelaçadas, o ícone de créditos. */
const CreditsIcon = ({ className = "credits-icon", size = 22 }: { className?: string; size?: number }) => <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <circle cx="9" cy="14.5" r="5.5" /><circle cx="15" cy="9.5" r="5.5" />
</svg>;

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Contador de créditos de IA do mês, no rodapé do menu lateral (visível a todos os membros). */
export function AiCreditsMeter({ credits }: { credits: AiCreditsView }) {
  const title = `Créditos de IA: ${formatCredits(credits.used)} de ${formatCredits(credits.limit)} usados neste mês`;
  return <div className={`credits-card is-${credits.level}`} data-tip={title} role="group" aria-label={title}>
    <CreditsIcon />
    {/* Menu recolhido: anel com o consumo e as moedas no meio. */}
    <span className="credits-ring" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="40" height="40"><circle className="credits-ring-track" cx="20" cy="20" r="17" /><circle className="credits-ring-value" cx="20" cy="20" r="17" pathLength={100} strokeDasharray={`${credits.percent} 100`} transform="rotate(-90 20 20)" /></svg>
      <CreditsIcon className="credits-ring-icon" size={18} />
    </span>
    <div className="credits-body collapse-hide">
      <div className="credits-head"><span>Créditos de IA</span><strong>{credits.percent}%</strong></div>
      <div className="credits-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={credits.percent} aria-label="Consumo de créditos de IA no mês"><span style={{ width: `${credits.percent}%` }} /></div>
      <small>{formatCredits(credits.used)} de {formatCredits(credits.limit)} neste mês</small>
      <small>{credits.level === "exhausted" ? "Créditos esgotados · " : ""}Renova em {day(credits.resetsOn)}</small>
    </div>
  </div>;
}
