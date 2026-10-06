import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = { title: "Política de Privacidade", robots: { index: true, follow: true } };

export default function PrivacyPage() {
  return <LegalPage title="Política de Privacidade">
    <p>O iGrow Reports é a plataforma de relatórios de tráfego pago da iGrow Digital. Ela reúne os resultados das campanhas de anúncios dos clientes da agência, gera relatórios e os entrega aos responsáveis indicados. Esta política explica quais dados tratamos, por que, com quem compartilhamos e como você pode exercer seus direitos, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).</p>

    <h2>1. Quem é o controlador</h2>
    <p>A iGrow Digital é a controladora dos dados tratados no iGrow Reports. Para qualquer assunto de privacidade, fale com <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.</p>

    <h2>2. Dados que tratamos</h2>
    <ul>
      <li><strong>Conta de acesso:</strong> nome, e-mail e senha (guardada pelo provedor de autenticação, nunca em texto aberto) de quem usa a plataforma, além do perfil de acesso no espaço de trabalho.</li>
      <li><strong>Dados de anúncios da Meta:</strong> quando um responsável autoriza pelo login da Meta, lemos as contas de anúncios escolhidas: nomes de campanhas, conjuntos e anúncios, investimento, impressões, alcance, cliques, resultados, situação de veiculação e dados de cobrança da conta (saldo, limite de gastos e forma de pagamento informada pela Meta). Não lemos mensagens, perfis pessoais nem listas de amigos.</li>
      <li><strong>Destinatários de relatórios:</strong> nome e telefone das pessoas indicadas pelo cliente para receber relatórios, com o registro da autorização de recebimento (data e origem) e de eventuais descadastros.</li>
      <li><strong>Mensagens de WhatsApp:</strong> quando um relatório é enviado pela API oficial do WhatsApp, guardamos o destinatário, o relatório, o horário e a situação informada pelo WhatsApp (enviado, entregue, lido ou falha). Não lemos o conteúdo de conversas.</li>
      <li><strong>Credenciais de integração:</strong> tokens de acesso da Meta e do WhatsApp, guardados criptografados e usados apenas pelo servidor.</li>
      <li><strong>Registros técnicos:</strong> data e hora de acessos e operações, para segurança e auditoria.</li>
    </ul>

    <h2>3. Para que usamos</h2>
    <ul>
      <li>Exibir os resultados das campanhas no painel e gerar relatórios em PDF.</li>
      <li>Enviar os relatórios pelo WhatsApp somente a destinatários com autorização registrada.</li>
      <li>Avisar sobre saldo baixo, pagamentos pendentes e outras situações que afetam a veiculação.</li>
      <li>Manter a segurança, investigar falhas e cumprir obrigações legais.</li>
    </ul>
    <p>As bases legais são a execução do contrato com a agência e seus clientes, o legítimo interesse na prestação do serviço contratado, o consentimento dos destinatários para receber mensagens e o cumprimento de obrigações legais. Não vendemos dados e não os usamos para publicidade.</p>

    <h2>4. Com quem compartilhamos</h2>
    <ul>
      <li><strong>Meta Platforms</strong> (Facebook, Instagram e WhatsApp): para ler os dados de anúncios autorizados e enviar as mensagens.</li>
      <li><strong>Supabase</strong>: banco de dados e autenticação.</li>
      <li><strong>Vercel</strong>: hospedagem da aplicação.</li>
    </ul>
    <p>Esses fornecedores tratam os dados apenas para operar o serviço. Alguns deles mantêm servidores fora do Brasil, com as salvaguardas previstas na LGPD.</p>

    <h2>5. Por quanto tempo guardamos</h2>
    <ul>
      <li>Dados detalhados de conjuntos e anúncios: 180 dias. Totais diários por campanha e conta: enquanto o cliente estiver ativo, para permitir comparações de períodos.</li>
      <li>Relatórios gerados e histórico de envios: enquanto o cliente estiver ativo na agência.</li>
      <li>Autorizações e descadastros de destinatários: pelo tempo necessário para comprovar o consentimento.</li>
      <li>Após o encerramento do contrato ou um pedido de exclusão, os dados são apagados ou anonimizados, salvo o que a lei exigir manter.</li>
    </ul>

    <h2>6. Seus direitos</h2>
    <p>Você pode pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade ou exclusão dos seus dados, e revogar consentimentos a qualquer momento. Destinatários podem deixar de receber relatórios pedindo o descadastro à agência ou pelo nosso contato. Veja como pedir a exclusão em <Link href="/exclusao-de-dados">Exclusão de dados</Link>.</p>

    <h2>7. Segurança</h2>
    <p>Usamos conexão criptografada, credenciais de integração criptografadas, controle de acesso por espaço de trabalho e por perfil, e registros de auditoria. Nenhum sistema é totalmente imune a incidentes; se ocorrer um que possa causar risco relevante, avisaremos os afetados e a ANPD.</p>

    <h2>8. Alterações</h2>
    <p>Podemos atualizar esta política. A data no topo indica a versão em vigor; mudanças relevantes serão comunicadas aos usuários da plataforma.</p>
  </LegalPage>;
}
