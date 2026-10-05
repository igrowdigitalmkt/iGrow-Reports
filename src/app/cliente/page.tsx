import Link from "next/link";
import { ArrowRight, Building2, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUserSession } from "@/modules/agencies/context";
import { needsPasswordSetup } from "@/modules/auth/password-state";
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
  // Invited accounts that signed in by email link still need a password.
  if (needsPasswordSetup(user)) redirect("/auth/definir-senha");
  const accesses = await getClientPortalAccesses(supabase);

  if (accesses.length === 1 && params.estado !== "sem-acesso") {
    redirect(`/cliente/${accesses[0].client.id}`);
  }

  const hasAccess = accesses.length > 0;
  return (
    <ClientPortalShell
      title={hasAccess ? "Escolha o cliente" : "Acesso ainda não liberado"}
      description={hasAccess
        ? "Selecione o ambiente que deseja consultar."
        : "Sua conta está autenticada, mas ainda não possui vínculo ativo com nenhum cliente."}
      userEmail={user.email}
    >
      {params.estado === "sem-acesso" && hasAccess && (
        <div role="alert" className="client-alert">
          <CircleAlert size={16} />
          <p>O cliente solicitado não está disponível para esta conta. Escolha um dos ambientes autorizados abaixo.</p>
        </div>
      )}

      {!hasAccess ? (
        <section className="client-panel client-no-access">
          <span className="client-no-access-icon"><Building2 size={20} /></span>
          <div>
            <h2>Nenhum cliente vinculado</h2>
            <p>
              Peça ao responsável pelo espaço de trabalho para liberar o acesso da sua conta. Nenhum dado de outro cliente fica disponível enquanto esse vínculo não existir.
            </p>
          </div>
        </section>
      ) : (
        <section className="client-selector-grid">
          {accesses.map(({ client }) => (
            <Link
              key={client.id}
              href={`/cliente/${client.id}`}
              className="client-selector-card"
            >
              <span className="client-selector-avatar">
                {client.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="client-selector-copy">
                <strong>{client.name}</strong>
                <small>{client.archivedAt ? "Cliente arquivado · histórico disponível" : "Acesso ativo"}</small>
              </div>
              <ArrowRight size={16} />
            </Link>
          ))}
        </section>
      )}
    </ClientPortalShell>
  );
}
