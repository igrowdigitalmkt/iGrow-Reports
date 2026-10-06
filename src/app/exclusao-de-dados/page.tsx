import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = { title: "Exclusão de dados", robots: { index: true, follow: true } };

export default function DataDeletionPage() {
  return <LegalPage title="Exclusão de dados">
    <p>Você pode pedir a exclusão dos dados tratados pelo iGrow Reports a qualquer momento. Esta página explica como.</p>

    <h2>Remover o acesso do iGrow à sua conta da Meta</h2>
    <ol>
      <li>No Facebook, abra <strong>Configurações e privacidade › Configurações › Integrações comerciais</strong> (ou <strong>Apps e sites</strong>).</li>
      <li>Encontre <strong>iGrow Digital</strong> e clique em <strong>Remover</strong>.</li>
      <li>A partir daí, o iGrow deixa de acessar suas contas de anúncios e seu WhatsApp Business. Os dados já coletados continuam guardados até você pedir a exclusão, como explicado abaixo.</li>
    </ol>

    <h2>Pedir a exclusão dos dados</h2>
    <ol>
      <li>Envie um e-mail para <a href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=Exclus%C3%A3o%20de%20dados%20iGrow%20Reports`}>{LEGAL_CONTACT_EMAIL}</a> com o assunto <strong>“Exclusão de dados iGrow Reports”</strong>.</li>
      <li>Informe o e-mail usado na plataforma, ou o telefone, se você recebe relatórios por WhatsApp, e o nome da empresa ou do cliente relacionado.</li>
      <li>Confirmaremos o pedido em até 5 dias úteis e concluiremos a exclusão em até 15 dias, informando o que foi apagado.</li>
    </ol>

    <h2>O que é apagado</h2>
    <ul>
      <li>Conta de acesso e vínculos com espaços de trabalho.</li>
      <li>Tokens de acesso da Meta e do WhatsApp.</li>
      <li>Dados de anúncios, relatórios e histórico de envios do cliente, quando o pedido for do responsável pela empresa.</li>
      <li>Nome e telefone de destinatários, mantendo apenas o registro mínimo do descadastro para não voltar a enviar mensagens.</li>
    </ul>
    <p>Podemos manter por mais tempo apenas o que a lei exigir, como registros de segurança e de consentimento, pelo prazo necessário.</p>

    <p>Mais detalhes na <Link href="/privacidade">Política de Privacidade</Link>.</p>
  </LegalPage>;
}
