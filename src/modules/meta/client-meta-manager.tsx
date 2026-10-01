"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Link2, Plug, RefreshCw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { collectClientMetaData, setClientAdAccount, setClientMetricMapping } from "./actions";
import type {
  ClientAdAccountLink,
  ClientMetricMapping,
  MetaAdminAccount,
  MetaIntegrationStatus,
} from "./types";

type Props = {
  agencyId: string;
  clientId: string;
  clientName: string;
  archived: boolean;
  ready: boolean;
  accounts: MetaAdminAccount[];
  initialLinks: ClientAdAccountLink[];
  initialMapping: ClientMetricMapping | null;
  integration: MetaIntegrationStatus | null;
};

const resultOptions = [
  { key: "leads", label: "Leads" },
  { key: "conversations", label: "Conversas" },
  { key: "purchases", label: "Compras" },
] as const;

export function ClientMetaManager({
  agencyId,
  clientId,
  clientName,
  archived,
  ready,
  accounts,
  initialLinks,
  initialMapping,
  integration,
}: Props) {
  const [links, setLinks] = useState(initialLinks);
  const [primaryMetricKey, setPrimaryMetricKey] = useState<
    "leads" | "conversations" | "purchases"
  >(initialMapping?.primaryMetricKey ?? "leads");
  const [primaryActionType, setPrimaryActionType] = useState(
    initialMapping?.primaryActionType ?? "",
  );
  const [revenueActionType, setRevenueActionType] = useState(
    initialMapping?.revenueActionType ?? "",
  );
  const [mappingReady, setMappingReady] = useState(!!initialMapping);
  const [collectionPeriod, setCollectionPeriod] = useState<"7d" | "30d">("30d");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const activeLinks = useMemo(
    () => new Set(links.filter((link) => link.active).map((link) => link.adAccountId)),
    [links],
  );
  const availableAccounts = accounts.filter((account) => !account.archivedAt);

  function toggleAccount(account: MetaAdminAccount) {
    const nextActive = !activeLinks.has(account.id);
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await setClientAdAccount({
        agencyId,
        clientId,
        adAccountId: account.id,
        active: nextActive,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setLinks((current) => {
        const existing = current.find((link) => link.adAccountId === account.id);
        if (existing) {
          return current.map((link) =>
            link.adAccountId === account.id ? { ...link, active: nextActive } : link,
          );
        }
        return [
          ...current,
          { clientId, adAccountId: account.id, active: nextActive },
        ];
      });
      setNotice(
        nextActive
          ? "Conta de anúncios associada ao cliente."
          : "Conta de anúncios removida do cliente.",
      );
    });
  }

  function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await setClientMetricMapping({
        agencyId,
        clientId,
        primaryMetricKey,
        primaryActionType,
        revenueActionType,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setMappingReady(true);
      setNotice("Resultado principal salvo.");
    });
  }

  function collect() {
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await collectClientMetaData({
        agencyId,
        clientId,
        period: collectionPeriod,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNotice(
        `Dados atualizados: ${result.insightCount ?? 0} dia(s)/conta coletados de ${result.dateFrom ?? "—"} a ${result.dateTo ?? "—"}.`,
      );
    });
  }

  return (
    <div className="space-y-6">
      <div className="info-banner mb-0">
        <Plug size={18} />
        <p>
          {ready ? <>Configuração de dados de <strong>{clientName}</strong>. A coleta é somente leitura e usa as contas sincronizadas pela integração Meta da agência.</> : <>A fundação Meta ainda não foi habilitada no banco de produção. Esta configuração ficará disponível após a migration correspondente.</>}
        </p>
      </div>

      <section>
        <div className="flex items-center justify-between gap-4">
          <div>
            <strong className="text-sm font-semibold">Contas de anúncios</strong>
            <p className="muted mt-1 text-xs">
              {activeLinks.size} conta(s) selecionada(s) para este cliente.
            </p>
          </div>
          <span className="badge neutral">
            {integration?.connectionStatus === "connected" ? "Meta conectada" : "Meta não conectada"}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {availableAccounts.length ? (
            availableAccounts.map((account) => {
              const active = activeLinks.has(account.id);
              return (
                <button
                  key={account.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3 text-left hover:bg-[var(--surface-hover)]"
                  disabled={pending || archived || !ready}
                  onClick={() => toggleAccount(account)}
                >
                  <span className={active ? "blue flex h-8 w-8 items-center justify-center rounded-md" : "neutral flex h-8 w-8 items-center justify-center rounded-md"}>
                    <Link2 size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium">{account.name}</strong>
                    <small className="muted mt-0.5 block">
                      {account.externalId} · {account.currency} · {account.timezoneName}
                    </small>
                  </span>
                  <span className={active ? "badge blue" : "badge neutral"}>
                    {active ? "Associada" : "Disponível"}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-6 text-center">
              <Plug className="muted mx-auto" size={21} />
              <strong className="mt-2 block text-sm font-medium">Nenhuma conta Meta sincronizada</strong>
              <p className="muted mx-auto mt-1 max-w-md text-xs leading-5">
                Assim que a integração Meta for configurada e sincronizada, as contas de anúncios disponíveis aparecerão aqui.
              </p>
            </div>
          )}
        </div>
      </section>

      <form onSubmit={saveMapping} className="border-t border-[var(--border)] pt-5">
        <div className="flex items-start gap-3">
          <span className="violet flex h-8 w-8 items-center justify-center rounded-md">
            <Target size={16} />
          </span>
          <div>
            <strong className="text-sm font-semibold">Resultado principal</strong>
            <p className="muted mt-1 text-xs">
              Defina qual resultado representa a conversão principal deste cliente e qual ação da Meta alimenta esse número.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Métrica principal
            <select
              className="input mt-2"
              value={primaryMetricKey}
              onChange={(event) => setPrimaryMetricKey(event.target.value as typeof primaryMetricKey)}
              disabled={pending || archived || !ready}
            >
              {resultOptions.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Ação Meta correspondente
            <input
              className="input mt-2"
              placeholder="Ex.: lead"
              value={primaryActionType}
              onChange={(event) => setPrimaryActionType(event.target.value)}
              disabled={pending || archived || !ready}
              required
            />
          </label>
        </div>

        <label className="mt-4 block text-sm">
          Ação de receita atribuída <span className="muted">(opcional)</span>
          <input
            className="input mt-2"
            placeholder="Ex.: omni_purchase"
            value={revenueActionType}
            onChange={(event) => setRevenueActionType(event.target.value)}
            disabled={pending || archived || !ready}
          />
        </label>

        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" disabled={pending || archived || !ready || !primaryActionType.trim()}>
            {pending ? <RefreshCw className="animate-spin" size={15} /> : <Target size={15} />}
            {pending ? "Salvando…" : "Salvar resultado"}
          </Button>
          {initialMapping && (
            <span className="muted text-xs">Configuração v{initialMapping.mappingVersion}</span>
          )}
        </div>
      </form>



      <section className="border-t border-[var(--border)] pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <strong className="text-sm font-semibold">Atualizar dados</strong>
            <p className="muted mt-1 text-xs leading-5">
              Coleta dados diários das contas associadas e recalcula os indicadores da Área do Cliente.
            </p>
          </div>
          <span className={integration?.connectionStatus === "connected" ? "badge green" : "badge neutral"}>
            {integration?.connectionStatus === "connected" ? "Meta conectada" : "Aguardando Meta"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            className="input compact-select"
            aria-label="Período de coleta Meta"
            value={collectionPeriod}
            onChange={(event) => setCollectionPeriod(event.target.value as "7d" | "30d")}
            disabled={pending || !ready}
          >
            <option value="7d">Últimos 7 dias completos</option>
            <option value="30d">Últimos 30 dias completos</option>
          </select>
          <Button
            type="button"
            variant="secondary"
            onClick={collect}
            disabled={
              pending ||
              archived ||
              !ready ||
              integration?.connectionStatus !== "connected" ||
              activeLinks.size === 0 ||
              !mappingReady
            }
          >
            <RefreshCw className={pending ? "animate-spin" : ""} size={15} />
            {pending ? "Atualizando…" : "Atualizar dados"}
          </Button>
        </div>
        {ready && integration?.connectionStatus === "connected" && activeLinks.size === 0 && (
          <p className="muted mt-3 text-xs">Associe ao menos uma conta de anúncios antes da coleta.</p>
        )}
        {ready && integration?.connectionStatus === "connected" && activeLinks.size > 0 && !mappingReady && (
          <p className="muted mt-3 text-xs">Salve o resultado principal antes da primeira coleta.</p>
        )}
      </section>

      {archived && (
        <p className="text-xs text-amber-400">
          Reative o cliente antes de alterar contas ou mapeamentos.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-500">{notice}</p>}
    </div>
  );
}
