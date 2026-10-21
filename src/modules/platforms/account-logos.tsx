import { PlatformLogo } from "./platform-logo";

export type LogoAccount = { platform: "meta" | "google"; id: string; name: string };

/**
 * Contas de anúncios de um cliente em logotipos: uma logo por conta (duas contas Meta = dois ícones da Meta), pequenas, com o nome da
 * conta ao passar o mouse e um texto para leitores de tela. Sem contas, diz que não há nenhuma.
 */
export function AccountLogos({ accounts, emptyText = "Sem contas vinculadas" }: { accounts: LogoAccount[]; emptyText?: string }) {
  if (!accounts.length) return <small>{emptyText}</small>;
  const ordered = [...accounts].sort((a, b) => (a.platform === b.platform ? 0 : a.platform === "meta" ? -1 : 1));
  const meta = ordered.filter(account => account.platform === "meta").length, google = ordered.length - meta;
  const label = [meta ? `${meta} ${meta === 1 ? "conta" : "contas"} Meta Ads` : null, google ? `${google} ${google === 1 ? "conta" : "contas"} Google Ads` : null].filter(Boolean).join(" e ");
  return <span className="portfolio-accounts" role="img" aria-label={label}>
    {ordered.map(account => <span key={`${account.platform}:${account.id}`} className="portfolio-account-logo" title={`${account.platform === "meta" ? "Meta Ads" : "Google Ads"} · ${account.name}`}>
      <PlatformLogo platform={account.platform} size={account.platform === "meta" ? 13 : 17} /></span>)}
  </span>;
}
