import Link from "next/link";
import { ArrowRight, Building2, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUserSession } from "@/modules/agencies/context";
import { getClientPortalAccesses } from "@/modules/client-portal/context";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";

export const metadata: Metadata = {
  title: "Área do Cliente",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ClientPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireUserSession("/cliente");
  const accesses = await getClientPortalAccesses(supabase);

  if (accesses.length === 1 && params.estado !== "sem-acesso") {
    redirect(`/cliente/${accesses[0].client.id}`);
  }

  const hasAccess = accesses.length > 0;
  return (
    <ClientPortalShell
      title={hasAccess ? "Escolha o cliente" : "Acesso ainda não liberado"}
      description={hasAccess
        ? "Selecione o ambiente que deseja consultar. Cada acesso é limitado aos dados autorizados pela agência."
        : "Sua conta está autenticada, mas ainda não possui vínculo ativo com nenhum cliente."}
      userEmail={user.email}
    >
      {params.estado === "sem-acesso" && hasAccess && (
        <div role="alert" className="mb-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <CircleAlert className="mt-0.5 shrink-0" size={18} />
          <p>O cliente solicitado não está disponível para esta conta. Escolha um dos ambientes autorizados abaixo.</p>
        </div>
      )}

      {!hasAccess ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <Building2 size={22} />
          </div>
          <h2 className="mt-5 text-lg font-semibold">Nenhum cliente vinculado</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Peça ao responsável da agência para liberar o acesso da sua conta. Nenhum dado de outro cliente fica disponível enquanto esse vínculo não existir.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accesses.map(({ client }) => (
            <Link
              key={client.id}
              href={`/cliente/${client.id}`}
              className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                  {client.name.slice(0, 2).toUpperCase()}
                </span>
                <ArrowRight className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-slate-700" size={18} />
              </div>
              <h2 className="mt-5 text-lg font-semibold">{client.name}</h2>
              <p className="mt-2 text-sm text-slate-500">
                {client.archivedAt ? "Cliente arquivado · histórico disponível" : "Acesso ativo"}
              </p>
            </Link>
          ))}
        </section>
      )}
    </ClientPortalShell>
  );
}
