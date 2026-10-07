"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Mail, Music2, QrCode, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { ClientItem } from "@/modules/clients/schema";
import { MetaIntegrationManager } from "@/modules/meta/integration-manager";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import { QrConnection } from "@/modules/whatsapp-qr/qr-connection";
import type { QrStatus } from "@/modules/whatsapp-qr/server";
import { WhatsAppManager, type WhatsAppSummary } from "@/modules/whatsapp/whatsapp-manager";
import { demoMetaClients, demoMetaSnapshot } from "./demo-integrations";

type Tone = "green" | "amber" | "blue" | "neutral";
type Panel = "meta" | "qr" | "official" | null;

const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));

function IntegrationCard({ logo, logoClass, name, description, status, tone, fact, action, onAction, disabled, featured, planned }: {
  logo: ReactNode; logoClass: string; name: string; description: string; status: string; tone: Tone;
  fact?: ReactNode; action?: string; onAction?: () => void; disabled?: boolean; featured?: boolean; planned?: boolean;
}) {
  return <article className={`panel hub-card${featured ? " is-featured" : ""}${planned ? " is-planned" : ""}`}>
    <div className="hub-card-top">
      <span className={`provider-logo ${logoClass}`}>{logo}</span>
      <span className={`badge ${tone}`}><span className="status-dot" />{status}</span>
    </div>
    <div className="hub-card-copy"><h3>{name}</h3><p>{description}</p></div>
    {fact && <div className="hub-card-fact">{fact}</div>}
    {onAction && action && <Button variant={featured ? "default" : "secondary"} size="sm" className="hub-card-action" onClick={onAction} disabled={disabled}>{action}<ArrowRight size={14} /></Button>}
  </article>;
}

// Catalog of integrations: one compact card each, details in a side panel.
export function IntegrationsHub({ demo, agencyId, clients, metaSnapshot, initialMetaClientId, canManage, whatsapp, whatsappReadiness, whatsappEmbedded }: {
  demo: boolean; agencyId?: string; clients: ClientItem[]; metaSnapshot?: MetaAdminSnapshot; initialMetaClientId?: string; canManage: boolean;
  whatsapp: WhatsAppSummary; whatsappReadiness: { ready: boolean; missing: string[] }; whatsappEmbedded: { configId: string; apiVersion: string; appId: string } | null;
}) {
  // Returning from the Facebook login (?client=…) reopens the Meta panel on that client.
  const [panel, setPanel] = useState<Panel>(!demo && initialMetaClientId ? "meta" : null);
  const [qr, setQr] = useState<QrStatus | null>(null);
  const live = !demo && !!agencyId;

  const loadQr = useCallback(() => {
    if (!live) return;
    fetch("/api/whatsapp/qr", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then((data: QrStatus | null) => { if (data) setQr(data); }).catch(() => undefined);
  }, [live]);
  useEffect(() => { loadQr(); }, [loadQr]);

  const activeClients = clients.filter(client => !client.archived_at);
  const metaClients = new Set(metaSnapshot?.connections.map(connection => connection.clientId) ?? []);
  const metaAccounts = metaSnapshot?.accounts.filter(account => !account.archivedAt) ?? [];
  const lastSync = metaSnapshot?.accounts.map(account => account.lastSyncedAt).filter((value): value is string => !!value).sort().at(-1) ?? null;
  const metaConnected = metaClients.size > 0;
  const metaError = metaSnapshot?.integration?.connectionStatus === "error";

  const qrConnected = qr && "state" in qr && qr.state === "connected" ? qr : null;
  const qrStatus = demo ? { label: "Simulado", tone: "blue" as Tone } : !qr ? { label: "Verificando", tone: "neutral" as Tone }
    : !qr.configured ? { label: "Indisponível", tone: "neutral" as Tone } : qrConnected ? { label: "Conectado", tone: "green" as Tone } : { label: "Desconectado", tone: "amber" as Tone };
  const officialReady = whatsapp.some(number => number.templateName);
  const firstOfficial = whatsapp[0];

  return <div className="hub">
    <section className="hub-group">
      <header><h2>Dados de anúncios</h2><p>De onde vêm os números dos painéis e relatórios.</p></header>
      <div className="hub-grid">
        <IntegrationCard logo="∞" logoClass="meta-logo" name="Meta Ads" description="Facebook e Instagram: campanhas, resultados, saldo e pagamentos de cada cliente."
          status={demo ? "Simulada" : metaError ? "Com erro" : metaConnected ? "Conectada" : "Não conectada"} tone={demo ? "blue" : metaError ? "amber" : metaConnected ? "green" : "neutral"}
          fact={demo ? <><strong>6 clientes</strong><span>dados fictícios</span></> : metaConnected ? <><strong>{metaClients.size} de {activeClients.length} {activeClients.length === 1 ? "cliente" : "clientes"}</strong><span>{metaAccounts.length} {metaAccounts.length === 1 ? "conta de anúncio" : "contas de anúncio"}{lastSync ? ` · sincronizado ${dateTime(lastSync)}` : ""}</span></> : <span>Conecte a conta de anúncios de cada cliente pelo login do Facebook.</span>}
          action={demo || metaConnected ? "Gerenciar" : "Conectar"} onAction={demo || (live && metaSnapshot) ? () => setPanel("meta") : undefined} featured={!metaConnected && !demo} />
        <IntegrationCard logo={<span className="font-semibold">G</span>} logoClass="neutral" name="Google Ads" description="Pesquisa, display e YouTube no mesmo painel do cliente." status="Em breve" tone="neutral" planned />
        <IntegrationCard logo={<Music2 size={17} />} logoClass="neutral" name="TikTok Ads" description="Campanhas e resultados do TikTok junto com as demais plataformas." status="Em breve" tone="neutral" planned />
      </div>
    </section>

    <section className="hub-group">
      <header><h2>Envio de relatórios</h2><p>Por onde os números chegam aos seus clientes.</p></header>
      <div className="hub-grid">
        <IntegrationCard logo={<QrCode size={17} />} logoClass="whatsapp-logo" name="Seu WhatsApp" description="Mensagens automáticas pelo seu próprio número, conectado por QR Code. Envia para pessoas e grupos."
          status={qrStatus.label} tone={qrStatus.tone}
          fact={qrConnected ? <><strong>{qrConnected.name ?? "Número conectado"}</strong><span>{qrConnected.phone ?? ""}</span></> : <span>Usado pelos Agendamentos. Conecte em menos de um minuto.</span>}
          action={qrConnected ? "Gerenciar" : "Conectar"} onAction={live ? () => setPanel("qr") : undefined} disabled={!!qr && !qr.configured} featured={live && !!qr && qr.configured && !qrConnected} />
        <IntegrationCard logo={<Send size={17} />} logoClass="whatsapp-logo" name="WhatsApp API oficial" description="Envio do relatório em PDF por mensagem modelo aprovada pela Meta. Opção avançada."
          status={demo ? "Simulado" : officialReady ? "Pronto" : whatsapp.length ? "Falta a mensagem modelo" : "Não conectado"} tone={demo ? "blue" : officialReady ? "green" : whatsapp.length ? "amber" : "neutral"}
          fact={firstOfficial ? <><strong>{whatsapp.length > 1 ? `${whatsapp.length} números` : firstOfficial.displayPhone ?? "Número oficial"}</strong><span>{whatsapp.length > 1 ? whatsapp.map(number => number.displayPhone).filter(Boolean).join(" · ") : firstOfficial.templateName ? `Modelo ${firstOfficial.templateName}` : "Sem mensagem modelo"}</span></> : undefined}
          action={whatsapp.length ? "Gerenciar" : "Configurar"} onAction={live ? () => setPanel("official") : undefined} />
        <IntegrationCard logo={<Mail size={17} />} logoClass="neutral" name="E-mail" description="Relatório em PDF por e-mail, junto com a mensagem do WhatsApp." status="Em breve" tone="neutral" planned />
      </div>
    </section>

    {demo && <Sheet open={panel === "meta"} onOpenChange={open => setPanel(open ? "meta" : null)} title="Meta Ads" description="Cada cliente tem a própria conexão. Escolha o cliente e as contas de anúncio.">
      <MetaIntegrationManager demo agencyId="demo" clients={demoMetaClients} snapshot={demoMetaSnapshot} canManage={false} />
    </Sheet>}
    {live && <>
      <Sheet open={panel === "meta"} onOpenChange={open => setPanel(open ? "meta" : null)} title="Meta Ads" description="Cada cliente tem a própria conexão. Escolha o cliente e as contas de anúncio.">
        {metaSnapshot && <MetaIntegrationManager agencyId={agencyId!} clients={activeClients} initialClientId={initialMetaClientId} snapshot={metaSnapshot} canManage={canManage} />}
      </Sheet>
      <Sheet open={panel === "qr"} onOpenChange={open => { setPanel(open ? "qr" : null); if (!open) loadQr(); }} title="Seu WhatsApp" description="Conecte o número que vai enviar os agendamentos.">
        <QrConnection canManage={canManage} onStatus={setQr} />
      </Sheet>
      <Sheet open={panel === "official"} onOpenChange={open => setPanel(open ? "official" : null)} title="WhatsApp API oficial" description="Números da Cloud API e mensagem modelo de cada um para o PDF do relatório.">
        <WhatsAppManager numbers={whatsapp} readiness={whatsappReadiness} canManage={canManage} embedded={whatsappEmbedded} />
      </Sheet>
    </>}
  </div>;
}
