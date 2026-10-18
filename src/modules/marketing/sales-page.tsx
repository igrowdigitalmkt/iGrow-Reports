"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, BrainCircuit, Check, ChevronDown, CircleHelp, Menu, Pause, Play, Plus, ShieldCheck, Sparkles, Target, Workflow, X } from "lucide-react";
import { DeviceShowcase, ProductShowcase, ProductTour } from "./sales-media";
import styles from "./sales-page.module.css";

// Display snapshot of the published catalog (18/10/2026). Checkout is unchanged.
const plans = [
  { name: "Start", description: "Para quem está construindo sua operação de anúncios.", monthly: 7990, yearly: 79900, clients: 10, accounts: 30, team: 1, automations: 5 },
  { name: "Pro", description: "Para acompanhar mais negócios sem multiplicar a rotina.", monthly: 14990, yearly: 149900, clients: 25, accounts: 75, team: 3, automations: 20 },
  { name: "Scale", description: "Para equipes com uma carteira maior de clientes.", monthly: 27990, yearly: 279900, clients: 60, accounts: 180, team: 6, automations: 60 },
];
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const navigation = [["A Groow por dentro", "#plataforma"], ["Nossa inteligência", "#inteligencia"], ["Planos", "#planos"], ["Dúvidas", "#duvidas"]];
const questions = [
  ["A IA já cria e otimiza campanhas sozinha?", "Ainda não. A criação, a pausa e os ajustes de orçamento por IA estão em desenvolvimento e não fazem parte dos recursos disponíveis nesta oferta. Nossa direção é permitir a execução delegada dentro dos objetivos e limites de cada negócio. Essa capacidade só será disponibilizada depois de implementada e validada nas plataformas de anúncios."],
  ["O que a inteligência artificial já faz?", "A IA usa os dados das contas conectadas e o perfil do negócio para preparar análises: comentários de relatório, resumos para WhatsApp e resumo da carteira. Os números vêm dos dados da plataforma. Você pode revisar os textos; nos envios com análise por IA, existe uma etapa de aprovação."],
  ["O que eu posso experimentar nos 7 dias grátis?", "Os recursos já disponíveis no teste: conectar contas, conhecer a análise dos anúncios, cadastrar o contexto dos clientes, preparar relatórios e configurar agendamentos. Os limites e recursos do teste ficam visíveis na plataforma. A execução autônoma de campanhas não está incluída."],
  ["Preciso de cartão de crédito para começar?", "Não. O teste começa com a criação do espaço de trabalho e dura sete dias. Para continuar, você escolhe um plano na área de assinatura. O investimento nos anúncios é separado da assinatura da Groow Ads."],
  ["Como a Groow Ads conhece meu negócio?", "Você pode preencher o perfil do cliente com segmento, oferta, região, público e objetivos. Esse contexto ajuda a IA a preparar análises mais específicas, junto dos dados das contas conectadas. O perfil pode ser completado aos poucos."],
  ["Como os resultados chegam ao meu cliente?", "Você pode preparar relatórios em PDF e agendar mensagens pelo seu WhatsApp conectado por QR Code. A API oficial é uma alternativa com configuração própria. Também existe uma área autenticada para o cliente acompanhar os resultados aos quais tem acesso."],
  ["A Groow Ads serve para quem cuida dos próprios anúncios?", "Sim. Gestores independentes, agências e equipes internas podem usar a Groow Ads. A estrutura permite acompanhar um negócio ou uma carteira de clientes, com acessos e limites definidos pelo plano."],
];

function Brand() {
  return <Image src="/brand/groow-ads-color.png" alt="Groow Ads" width={1179} height={212} className={styles.logo} />;
}

export function SalesPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [yearly, setYearly] = useState(false);
  const [paused, setPaused] = useState(false);
  return <div className={styles.site} data-motion={paused ? "paused" : "playing"}>
    <a href="#conteudo" className={styles.skipLink}>Pular para o conteúdo</a>
    <header className={styles.header}>
      <Link href="/" aria-label="Groow Ads, início"><Brand /></Link>
      <nav className={styles.desktopNav} aria-label="Navegação do site">{navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
      <div className={styles.headerActions}><Link href="/entrar" className={styles.login}>Entrar <ArrowUpRight size={14} /></Link><Link href="/criar-conta" className={styles.headerCta}>Começar grátis <ArrowRight size={15} /></Link><button className={styles.menuToggle} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="sales-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div>
    </header>
    {menuOpen && <nav id="sales-mobile-menu" className={styles.mobileNav} aria-label="Navegação móvel">{navigation.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}<ArrowUpRight size={16} /></a>)}<Link href="/entrar">Entrar na plataforma <ArrowRight size={16} /></Link></nav>}
    <main>
      <div className={styles.heroArea}>
        <section id="conteudo" className={styles.hero}>
          <span className={styles.eyebrow}><Sparkles size={14} /> INTELIGÊNCIA A SERVIÇO DO SEU NEGÓCIO</span>
          <h1>Seu marketing precisa avançar.<br /><span>Você não precisa fazer tudo.</span></h1>
          <p>Seu negócio tem uma história, uma oferta e objetivos próprios. A Groow Ads conecta esse contexto aos dados dos anúncios para tirar trabalho da sua rotina — da análise à entrega.</p>
          <div className={styles.heroActions}><Link href="/criar-conta" className={styles.primaryCta}>Testar grátis por 7 dias <ArrowRight size={18} /></Link><a href="#demonstracao" className={styles.secondaryCta}><Play size={16} /> Ver a Groow em ação</a></div>
          <div className={styles.heroChecks}><span><Check size={14} /> Sem cartão de crédito</span><span><Check size={14} /> IA para análises e resumos</span></div>
          <p className={styles.availability}>Hoje: análises com IA e entregas agendadas. Execução de campanhas por IA em desenvolvimento.</p>
          <div className={styles.heroGlow} aria-hidden="true" />
        </section>
        <div className={styles.heroVisual}><div className={styles.visualHeading}><span><i /> INTERFACE REAL. DADOS DEMONSTRATIVOS.</span><button onClick={() => setPaused(!paused)} aria-pressed={paused} aria-label={paused ? "Ativar animações decorativas" : "Pausar animações decorativas"}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? "Ativar movimento" : "Pausar movimento"}</button></div><DeviceShowcase /></div>
        <div className={styles.manifesto}><span>O QUE NOS MOVE</span><p>Você define a direção.<br /><strong>A inteligência assume cada vez mais do trabalho.</strong></p><a href="#inteligencia" aria-label="Conhecer a inteligência da Groow Ads"><ArrowDown size={22} /></a></div>
      </div>

      <section id="inteligencia" className={styles.intelligence}>
        <div className={styles.sectionHeading}><span className={styles.sectionKicker}>UM NEGÓCIO REAL TEM CONTEXTO.</span><h2>A inteligência começa<br /><span>entendendo o seu.</span></h2><p>Uma campanha não conta a história inteira. O que você vende, para quem vende e o que pretende alcançar dão sentido aos números.</p></div>
        <div className={styles.principles}>
          <article><BrainCircuit /><span>01 / CONTEXTO</span><h3>Seu negócio não começa do zero a cada análise.</h3><p>Registre oferta, público, região e objetivos no perfil do cliente. A IA usa esse contexto junto dos dados para preparar comentários mais específicos.</p></article>
          <article><Target /><span>02 / PRIORIDADE</span><h3>Menos tempo procurando. Mais clareza sobre o próximo passo.</h3><p>Compare períodos, veja os resultados por conta e acompanhe os clientes que pedem atenção. A IA ajuda a transformar esses fatos em uma análise compreensível.</p></article>
          <article><Workflow /><span>03 / CONTINUIDADE</span><h3>O trabalho precisa continuar depois da análise.</h3><p>Prepare o relatório, revise a mensagem e programe as entregas. O histórico permite acompanhar o que foi enviado e identificar falhas.</p></article>
        </div>
      </section>

      <section id="plataforma" className={styles.productSection}>
        <div className={styles.sectionHeading}><span className={styles.sectionKicker}>VEJA O PRODUTO QUE VOCÊ VAI USAR.</span><h2>Por dentro da Groow.<br /><span>Veja o trabalho acontecer.</span></h2><p>Explore capturas da própria plataforma. Os nomes, valores e conversas são demonstrativos; a interface é a do produto.</p></div>
        <ProductShowcase />
      </section>

      <section id="demonstracao" className={styles.tourSection}>
        <div className={styles.tourCopy}><span className={styles.sectionKicker}>DO DADO AO TRABALHO ENTREGUE.</span><h2>Veja o caminho.<br /><span>Na tela de verdade.</span></h2><p>Uma gravação da navegação pela análise de um cliente, pelos agendamentos e pelo acompanhamento das entregas.</p><p className={styles.smallNote}>Ambiente demonstrativo. Sem alteração de campanhas, envio de mensagens ou dados de clientes reais.</p></div>
        <ProductTour />
      </section>

      <section className={styles.workSection}>
        <div className={styles.workImage}><Image src="/product/automations.webp" alt="Tela real de agendamentos da Groow Ads, com clientes e rotinas de envio demonstrativos" width={1440} height={1000} sizes="(max-width: 760px) 100vw, 55vw" /><span><Check size={14} /> ROTINAS COM DIA, HORA E HISTÓRICO.</span></div>
        <div className={styles.workCopy}><span className={styles.sectionKicker}>TRABALHO QUE JÁ SAI DA SUA LISTA.</span><h2>Parar para escrever.<br />Lembrar de enviar.<br /><span>Repetir tudo de novo.</span></h2><p>A rotina de anúncios não termina quando os números chegam. É preciso explicar o que aconteceu e manter quem decide bem informado.</p><ul><li><Check /><div><strong>Comece a análise com um rascunho da IA.</strong><span>Comentários e resumos preparados a partir dos dados e do contexto do cliente, para você revisar.</span></div></li><li><Check /><div><strong>Defina uma vez a frequência da entrega.</strong><span>Agende mensagens com os números do período e acompanhe o histórico de envio pelo WhatsApp.</span></div></li><li><Check /><div><strong>Dê acesso ao resultado sem refazer a apresentação.</strong><span>Relatórios em PDF e área do cliente para consultar os próprios indicadores e documentos.</span></div></li></ul></div>
      </section>

      <section className={styles.roadmap} aria-labelledby="roadmap-title">
        <div className={styles.roadmapIntro}><span className={styles.development}>EM DESENVOLVIMENTO</span><h2 id="roadmap-title">O próximo passo:<br /><span>delegar a execução.</span></h2><p>A direção da Groow Ads é clara: conhecer o negócio, receber objetivos e limites e executar o trabalho nas contas de anúncios. Você acompanha o que foi feito, por quê e o que aconteceu depois.</p><p className={styles.roadmapNote}>Estas capacidades ainda não estão disponíveis nos planos. A liberação depende de implementação e validação real nas plataformas de anúncios.</p></div>
        <div className={styles.actionPath}>{[["01", "Planejar a partir do negócio", "Objetivo, oferta, público e orçamento orientam o plano."], ["02", "Agir dentro dos limites delegados", "Criar campanhas, ajustar orçamento e pausar ou reativar anúncios elegíveis."], ["03", "Verificar, acompanhar e aprender", "Confirmar a ação aplicada e usar o histórico para orientar os próximos passos."]].map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div><ChevronDown size={18} /></article>)}<span className={styles.pathCaption}>Visão do produto · não é uma simulação de uma função disponível.</span></div>
      </section>

      <section className={styles.audience}><span className={styles.sectionKicker}>PARA QUEM RESPONDE PELO RESULTADO.</span><h2>Uma empresa ou uma carteira inteira.<br /><span>O seu tempo continua sendo um só.</span></h2><div>{[["Gestores de tráfego", "Devolva espaço à estratégia. Use a IA na preparação das análises e tire os envios recorrentes da sua memória."], ["Agências", "Acompanhe o contexto de cada cliente, organize o trabalho da equipe e mantenha as entregas com continuidade."], ["Equipes internas", "Reúna os dados do negócio e dos anúncios. Compartilhe a evolução com quem precisa decidir."]].map(([title, text], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{text}</p></article>)}</div></section>

      <section id="planos" className={styles.pricing}><div className={styles.centerHeading}><span className={styles.sectionKicker}>CONHEÇA O TRABALHO QUE JÁ PODE DELEGAR.</span><h2>Comece com a Groow.<br /><span>Veja a diferença na sua rotina.</span></h2><p>Sete dias para experimentar os recursos disponíveis. Sem cartão.</p></div><div className={styles.billingToggle} role="group" aria-label="Período de cobrança"><button aria-pressed={!yearly} onClick={() => setYearly(false)}>Mensal</button><button aria-pressed={yearly} onClick={() => setYearly(true)}>Anual <span>Economize</span></button></div><div className={styles.planGrid}>{plans.map((plan, index) => <article className={`${styles.planCard} ${index === 1 ? styles.recommendedPlan : ""}`} key={plan.name}>{index === 1 && <span className={styles.planBadge}><Sparkles size={12} /> RECOMENDADO</span>}<span className={styles.planName}>{plan.name}</span><p>{plan.description}</p><div className={styles.planPrice}><span>R$</span><strong>{money(yearly ? plan.yearly : plan.monthly)}</strong><span>/{yearly ? "ano" : "mês"}</span></div><small className={styles.planBilling}>{yearly ? "Cobrança anual em pagamento integral." : "Cobrança mensal."}</small><Link href="/criar-conta" className={index === 1 ? styles.primaryCta : styles.planCta}>Experimentar a Groow <ArrowRight size={16} /></Link><div className={styles.planDivider} /><span className={styles.planIncludes}>RECURSOS E LIMITES ATUAIS</span><ul>{[`${plan.clients} clientes`, `${plan.accounts} contas de anúncios`, `${plan.team} ${plan.team === 1 ? "pessoa na equipe" : "pessoas na equipe"}`, `${plan.automations} automações ativas`, "Análises com IA, com limite de uso", "Relatórios e portal do cliente"].map(item => <li key={item}><Check size={15} />{item}</li>)}</ul></article>)}</div><p className={styles.planNote}><ShieldCheck size={16} /> O investimento em anúncios é separado. Execução autônoma de campanhas em desenvolvimento, não incluída nesta oferta. Recursos e limites completos na área de assinatura.</p></section>

      <section id="duvidas" className={styles.faq}><div><span className={styles.sectionKicker}>CLAREZA ANTES DE COMEÇAR.</span><h2>O que a Groow faz.<br /><span>E o que vem depois.</span></h2><p>Entenda a inteligência, os recursos atuais e o seu primeiro passo.</p><CircleHelp size={30} /></div><div className={styles.faqItems}>{questions.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={19} /></summary><p>{answer}</p></details>)}</div></section>
      <section className={styles.finalCta}><span className={styles.eyebrow}><Sparkles size={14} /> MAIS TRABALHO FEITO. MAIS TEMPO SEU.</span><h2>Conheça seu próximo jeito<br /><span>de trabalhar com marketing.</span></h2><p>Comece pelas análises com IA e pelas entregas agendadas.<br />Veja a Groow Ads trabalhando na sua rotina.</p><Link href="/criar-conta" className={styles.primaryCta}>Começar meus 7 dias grátis <ArrowRight size={18} /></Link><small>Sem cartão. Você conhece antes de contratar.</small></section>
    </main>
    <footer className={styles.footer}><div className={styles.footerTop}><div><Link href="/" aria-label="Groow Ads, início"><Brand /></Link><p>Inteligência para conhecer o negócio.<br />Tecnologia para assumir o trabalho.</p></div><nav aria-label="Links do rodapé"><a href="#plataforma">A plataforma</a><a href="#inteligencia">Nossa inteligência</a><a href="#planos">Planos</a><Link href="/entrar">Entrar</Link></nav></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} Groow Ads · Uma plataforma da iGrow Digital.</span><div><Link href="/privacidade">Privacidade</Link><Link href="/exclusao-de-dados">Exclusão de dados</Link></div></div></footer>
  </div>;
}
