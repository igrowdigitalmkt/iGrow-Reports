import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = { title: "Termos de Serviço", robots: { index: true, follow: true } };

export default function TermsPage() {
  return <LegalPage title="Termos de Serviço">
    <p>Estes termos regem o uso do Groow Ads, plataforma da iGrow Digital que reúne resultados de anúncios, relatórios e contatos (leads) de quem usa a plataforma e de seus clientes. Ao criar uma conta ou usar a plataforma, você concorda com eles.</p>

    <h2>1. O serviço</h2>
    <p>O Groow Ads permite conectar contas de anúncios e canais de contato (como Páginas e contas do Facebook e do Instagram, WhatsApp e Google Ads), acompanhar resultados, gerar relatórios, receber e organizar leads e, quando autorizado pelo responsável da conta, executar ações em campanhas dentro dos limites configurados. Os recursos disponíveis dependem do plano contratado e das integrações liberadas pelas plataformas de terceiros.</p>

    <h2>2. Conta e acesso</h2>
    <ul>
      <li>Quem cria o espaço de trabalho é responsável pelas informações cadastradas e pelas pessoas que convida, e define o que cada pessoa pode ver e fazer.</li>
      <li>Mantenha suas credenciais em sigilo. Atividades feitas com a sua conta são de sua responsabilidade.</li>
      <li>Você deve ter poderes para contratar em nome da empresa ou do cliente que representa.</li>
    </ul>

    <h2>3. Integrações com terceiros</h2>
    <ul>
      <li>Ao conectar Meta (Facebook, Instagram, WhatsApp), Google ou outro serviço, você autoriza o Groow Ads a acessar os dados que você escolher e a agir dentro das permissões concedidas. Você pode revogar o acesso a qualquer momento, na plataforma ou no serviço de origem.</li>
      <li>O uso dessas plataformas continua sujeito aos termos e às políticas delas. A disponibilidade, os limites e as mudanças nessas integrações não dependem do Groow Ads.</li>
      <li>A conexão de número de WhatsApp por QR Code não é a API oficial do WhatsApp: é usada por sua conta e risco, com um número que já tenha conversas, sem envios em massa e respeitando as regras do aplicativo.</li>
    </ul>

    <h2>4. Seus contatos e leads</h2>
    <p>Você é responsável por ter base legal e, quando necessário, o consentimento das pessoas cujos dados chegam à plataforma pelos seus anúncios e canais, e por usá-los de forma lícita, respeitando a Lei Geral de Proteção de Dados (LGPD). Não envie mensagens a quem não autorizou nem use a plataforma para spam. Pedidos de descadastro feitos pelos contatos devem ser respeitados.</p>

    <h2>5. Uso permitido</h2>
    <p>É proibido usar a plataforma para fins ilegais, fraudulentos ou enganosos, tentar acessar dados de outros espaços de trabalho, interferir no funcionamento do serviço, copiar ou revender o serviço sem autorização, ou conectar contas e dados que você não tenha direito de usar.</p>

    <h2>6. Ações automáticas e decisões</h2>
    <p>Quando a plataforma sugerir ou executar ações em campanhas, ela o faz apenas dentro do que o responsável configurou e autorizou. As decisões sobre investimento e estratégia continuam sendo suas. Resultados de anúncios dependem de fatores externos e não são garantidos.</p>

    <h2>7. Planos e pagamento</h2>
    <p>O uso pode depender de assinatura, com valores, ciclo de cobrança e recursos informados no momento da contratação. Em caso de atraso ou cancelamento, o acesso pode ser limitado ou encerrado conforme as condições do plano.</p>

    <h2>8. Disponibilidade e responsabilidade</h2>
    <p>Trabalhamos para manter o serviço disponível e seguro, mas ele pode sofrer interrupções, inclusive por falhas ou mudanças em plataformas de terceiros. Dentro do que a lei permite, a iGrow Digital não responde por danos indiretos, lucros cessantes ou perdas decorrentes de decisões tomadas com base nos dados exibidos, nem pela indisponibilidade de serviços de terceiros.</p>

    <h2>9. Propriedade intelectual</h2>
    <p>A plataforma, a marca e o código pertencem à iGrow Digital. Os dados e conteúdos que você conecta continuam sendo seus; você nos autoriza a tratá-los para prestar o serviço, conforme a <Link href="/privacidade">Política de Privacidade</Link>.</p>

    <h2>10. Encerramento e exclusão de dados</h2>
    <p>Você pode encerrar o uso a qualquer momento. Após o encerramento ou um pedido de exclusão, os dados são apagados ou anonimizados nos prazos descritos na Política de Privacidade. Veja como pedir a exclusão em <Link href="/exclusao-de-dados">Exclusão de dados</Link>.</p>

    <h2>11. Alterações</h2>
    <p>Podemos atualizar estes termos. Mudanças relevantes serão avisadas na plataforma ou por e-mail, e o uso após o aviso indica concordância com a nova versão.</p>

    <h2>12. Lei aplicável e contato</h2>
    <p>Estes termos seguem as leis do Brasil. Dúvidas ou pedidos: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.</p>
  </LegalPage>;
}
