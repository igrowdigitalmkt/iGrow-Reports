import { requirePlatformOperator } from "@/modules/platform-admin/guard";
import { setFeatureSwitchAction } from "@/modules/platform-admin/commercial/actions";
import { ActionForm, dangerButton, inputClass, secondaryButton, SubmitButton } from "@/modules/platform-admin/commercial/action-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recursos e interruptores" };

export default async function FeaturesPage() {
  const { supabase } = await requirePlatformOperator();
  const { data: definitions, error } = await supabase.rpc("platform_list_definitions");
  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Recursos e interruptores</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--secondary)]">Catálogo dos recursos que o Groow Ads realmente sabe controlar. Só estes podem entrar nos planos: cadastrar algo novo exige que o código passe a aplicá-lo. O interruptor global é de emergência e vale para <strong>todas</strong> as organizações, com ou sem plano, acima de planos e concessões.</p>
    </header>
    {error && <p role="alert" className="text-sm text-[var(--bad)]">Não foi possível carregar o catálogo agora.</p>}
    <section aria-label="Funcionalidades" className="space-y-3">
      <h2 className="text-sm font-semibold">Funcionalidades (com interruptor global)</h2>
      {definitions?.filter((def) => def.kind === "feature").map((def) => <article key={def.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="font-medium">{def.label} <code className="ml-1 text-xs text-[var(--muted)]">{def.key}</code></h3><p className="mt-0.5 text-sm text-[var(--secondary)]">{def.description}</p></div>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${def.globally_enabled ? "border-[var(--good)]/40 text-[var(--good)]" : "border-[var(--bad)]/40 text-[var(--bad)]"}`}>{def.globally_enabled ? "Ativo" : "Desativado globalmente"}</span>
        </div>
        {def.globally_enabled
          ? <ActionForm action={setFeatureSwitchAction} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <>
              <input type="hidden" name="key" value={def.key} /><input type="hidden" name="enable" value="0" />
              <div className="space-y-2"><label className="block text-sm font-medium text-[var(--secondary)]" htmlFor={`reason-${def.key}`}>Desativar para todas as organizações</label>
                <input id={`reason-${def.key}`} name="reason" required minLength={3} maxLength={300} placeholder="Motivo (fica na auditoria)" className={inputClass} />
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="checkbox" name="confirm" />Entendo que isso bloqueia o recurso para todos agora.</label></div>
              <SubmitButton className={dangerButton}>Desativar</SubmitButton>
            </>
          </ActionForm>
          : <div className="mt-4 text-sm"><p className="text-[var(--secondary)]">Motivo: {def.disabled_reason}{def.disabled_at ? ` · desde ${when.format(new Date(def.disabled_at))}` : ""}</p>
            <ActionForm action={setFeatureSwitchAction} className="mt-3"><><input type="hidden" name="key" value={def.key} /><input type="hidden" name="enable" value="1" /><SubmitButton className={secondaryButton}>Reativar</SubmitButton></></ActionForm></div>}
      </article>)}
    </section>
    <section aria-label="Limites" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold">Limites de utilização</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">Configurados em cada plano e, quando preciso, por concessão em uma organização. Não têm interruptor global.</p>
      <ul className="mt-3 divide-y divide-[var(--border)]">{definitions?.filter((def) => def.kind === "limit").map((def) => <li key={def.key} className="py-2.5 text-sm"><span className="font-medium">{def.label}</span> <code className="text-xs text-[var(--muted)]">{def.key}</code><span className="block text-xs text-[var(--muted)]">{def.description}</span></li>)}</ul>
    </section>
  </div>;
}
