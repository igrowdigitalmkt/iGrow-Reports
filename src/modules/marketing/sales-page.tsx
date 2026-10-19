"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Clock3, Menu, Play, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { DeviceShowcase, ProductShowcase, ProductTour } from "./sales-media";
import styles from "./sales-page.module.css";
import { EXECUTION_LIVE as live } from "./sales-flags";
import { CoreMotion, Motion, MotionDefs, type MotionKind } from "./sales-motion";
import { photos, type SalesPhoto } from "./sales-photos";

// Fotografia do catálogo publicado (consulta somente leitura em 19/10/2026). A contratação continua validando no servidor.
const plans = [
  { name: "Start", description: "Para quem está construindo sua operação de anúncios.", monthly: 7990, yearly: 79900, clients: 10, accounts: 30, team: 1, automations: 5, whatsapp: 1, ai: "franquia padrão" },
  { name: "Pro", description: "Para acompanhar mais negócios sem multiplicar a rotina.", monthly: 14990, yearly: 149900, clients: 25, accounts: 75, team: 3, automations: 20, whatsapp: 2, ai: "O dobro do Start" },
  { name: "Scale", description: "Para equipes com uma carteira maior de clientes.", monthly: 27990, yearly: 279900, clients: 60, accounts: 180, team: 6, automations: 60, whatsapp: 3, ai: "Quatro vezes o Start" },
];
type Plan = (typeof plans)[number];
const planLimits = (plan: Plan): [string, string][] => [
  [`${plan.clients} clientes`, "Empresas ou marcas que você acompanha na plataforma."],
  [`${plan.accounts} contas de anúncios`, "Contas conectadas, somando todos os clientes."],
  [plan.team === 1 ? "1 usuário" : `${plan.team} usuários na equipe`, "Pessoas com acesso ao seu espaço de trabalho."],
  [`${plan.automations} agendamentos de relatório`, "Envios automáticos que se repetem, como “toda segunda, às 9h, para o cliente X”."],
  [`${plan.whatsapp} ${plan.whatsapp === 1 ? "número" : "números"} de WhatsApp oficial`, "Conectados pela API oficial para enviar as mensagens."],
  [`IA: ${plan.ai}`, "Volume mensal de análises e textos escritos pela IA."],
];
const everyPlan = [
  ...(live ? ["IA que executa nas campanhas, dentro dos seus limites"] : []),
  "Dashboards e métricas por cliente e por carteira", "Análises e resumos escritos pela IA", "Relatórios em PDF, na vertical (A4) e na horizontal",
  "Modo apresentação em tela cheia", "Relatórios por WhatsApp e por e-mail", "Agendamentos com histórico de entrega", "Portal para o seu cliente", "Perfil do negócio de cada cliente",
];
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const navigation = [["O problema", "#problema"], ["Como funciona", "#como-funciona"], ["Produto", "#plataforma"], ["Recursos", "#recursos"], ["Planos", "#planos"], ["Dúvidas", "#duvidas"]];

const chores = [
  ["Abrir conta por conta para descobrir o que mudou.", "Antes de decidir qualquer coisa, você já gastou a primeira hora do dia."],
  ["Copiar números e escrever a mesma análise, de novo.", "O relatório do mês toma o tempo que a estratégia pediria."],
  ["Lembrar quem recebe o quê, e quando.", "Cada envio manual é mais um item na sua memória."],
  ["Responder “como estão os anúncios?” a qualquer hora.", "O cliente quer clareza. Você precisa montá-la na hora."],
];
const steps = [
  ["01", "Conte o seu negócio", "Oferta, público, região e objetivos entram uma vez no perfil do cliente. A inteligência deixa de começar do zero a cada análise.", live ? "Perfil do negócio" : "Disponível hoje", false],
  ["02", "Conecte e defina o escopo", "Ligue as contas de anúncios e decida o que a Groow pode fazer sozinha e o que pede a sua aprovação.", live ? "Contas e limites" : "Contas: hoje · Escopos de ação: em desenvolvimento", !live],
  ["03", "A Groow trabalha. Você acompanha.", live ? "A Groow analisa, cria, ajusta e corrige campanhas dentro dos seus limites, e entrega os resultados. Cada ação fica registrada para você acompanhar." : "Hoje: análises, relatórios e entregas agendadas. Em breve: criar, ajustar e corrigir campanhas dentro dos seus limites, com registro de cada ação.", live ? "Execução e acompanhamento" : "Execução em campanhas: em desenvolvimento", !live],
] as const;
const contrast = [
  ["O contexto do negócio vive na cabeça de quem gerencia e some quando a equipe muda.", "O perfil do negócio fica registrado e orienta cada análise e cada decisão."],
  ["Um problema na campanha aparece quando o cliente já perguntou.", "A Groow acompanha as contas e corrige o que estiver dentro dos limites que você definiu."],
  ["Ajustar orçamento depende de alguém abrir a conta no momento certo.", "Ajustes feitos dentro do teto e das regras combinadas, com o motivo registrado."],
  ["O relatório é montado na mão, no fim do mês.", "Relatório e resumo prontos, entregues no dia e no canal combinados."],
  ["Cada decisão é esquecida, e o aprendizado não se acumula.", "O histórico de ações e resultados vira memória para as próximas decisões."],
];
const control = [
  ["Limites definidos por você", "Orçamento, escopo e regras de atuação são configurados antes de qualquer ação."],
  ["Cada ação registrada", "O que foi feito, quando e por quê fica no histórico para consulta."],
  ["Aprovação quando você quiser", "Defina o que a Groow faz sozinha e o que só acontece com o seu aval."],
  ["Você assume a qualquer momento", "Pause a atuação e retome o controle das campanhas quando precisar."],
];
const features: [MotionKind, string, string][] = [
  ["dashboard", "Dashboards e métricas", "Investimento, resultados e saldo por cliente e por carteira, com períodos comparáveis e visão por conta de anúncios."],
  ["message", "Relatório por mensagem", "O resumo com os números do período segue pelo seu WhatsApp, no dia e na hora combinados, com histórico de entrega."],
  ["pdf", "Relatórios em PDF", "Documento pronto para o cliente, na vertical (A4) ou na horizontal, com o layout que você configurar."],
  ["present", "Modo apresentação", "Abra o painel em tela cheia ou gere o relatório horizontal em 1920 × 1080 para apresentar resultados em reunião."],
  ["email", "Relatório por e-mail", "O PDF segue em uma mensagem com layout próprio, junto do envio pelo WhatsApp."],
  ["ai", "Análise por IA", "Comentários e resumos escritos a partir dos dados e do contexto do negócio, para você revisar antes de enviar."],
  ["portal", "Portal do cliente", "Seu cliente consulta os próprios resultados e documentos em uma área autenticada."],
  ["schedule", "Agendamentos", "Defina frequência, destinatários e conteúdo uma vez. As entregas acontecem sem você lembrar."],
];
const available = ["Perfil do negócio que orienta a análise da IA", "Análises e resumos com IA, a partir dos dados das contas", "Relatórios em PDF prontos para o cliente", "Entregas agendadas pelo seu WhatsApp, com histórico", "Portal para o cliente consultar os próprios resultados"];
const upcoming = ["Criar campanhas a partir dos objetivos do negócio", "Ajustar orçamentos dentro dos limites que você definir", "Pausar e reativar anúncios elegíveis", "Confirmar na plataforma que a ação foi aplicada", "Aprender com o histórico e acompanhar o resultado depois"];
const questions = [
  [live ? "A IA cria e otimiza campanhas sozinha?" : "A IA já cria e otimiza campanhas sozinha?", live ? "Dentro dos limites que você define, sim. Você informa objetivos, orçamento e o que a Groow pode fazer sozinha; o que passar disso pede a sua aprovação. Cada ação fica registrada, e a Groow confere na plataforma que ela foi aplicada." : "Ainda não. A criação, a pausa e os ajustes de orçamento por IA estão em desenvolvimento e não fazem parte dos recursos desta oferta. É a direção do produto: executar dentro dos objetivos e limites de cada negócio. Só será anunciada como disponível depois de implementada e validada nas plataformas de anúncios."],
  [live ? "O que a inteligência artificial faz?" : "O que a inteligência artificial já faz?", live ? "Lê os dados das contas conectadas e o perfil de cada negócio, escreve análises e resumos e executa nas campanhas o que estiver dentro dos limites que você definiu: criar campanhas, ajustar orçamentos, pausar ou reativar anúncios. Cada ação fica registrada para você acompanhar." : "Usa os dados das contas conectadas e o perfil do negócio para preparar análises: comentários de relatório, resumos para WhatsApp e resumo da carteira. Os números vêm da plataforma. Você revisa os textos; nos envios com análise por IA existe uma etapa de aprovação."],
  ["O que posso experimentar nos 7 dias grátis?", live ? "Conectar contas, cadastrar o contexto dos clientes, receber análises, preparar relatórios, configurar agendamentos e experimentar a execução nas campanhas dentro dos limites que você definir. Os limites do teste ficam visíveis na plataforma." : "Os recursos já disponíveis: conectar contas, conhecer a análise dos anúncios, cadastrar o contexto dos clientes, preparar relatórios e configurar agendamentos. Os limites do teste ficam visíveis na plataforma. A execução autônoma de campanhas não está incluída."],
  ["O que são os agendamentos de relatório dos planos?", "São envios automáticos que se repetem sozinhos. Por exemplo: o relatório do cliente X segue toda segunda-feira, às 9h, pelo WhatsApp. Cada rotina ativa conta como um agendamento, e você pode pausar ou reativar quando quiser."],
  ["O que conta como cliente e como conta de anúncios?", "Cliente é cada empresa ou marca que você acompanha na Groow Ads. Contas de anúncios são as contas conectadas a esses clientes, somadas em toda a carteira; um cliente pode ter mais de uma conta."],
  ["Preciso de cartão de crédito para começar?", "Não. O teste começa com a criação do espaço de trabalho e dura sete dias. Para continuar, você escolhe um plano na área de assinatura. O investimento nos anúncios é separado da assinatura da Groow Ads."],
  ["Como a Groow Ads conhece meu negócio?", "Você preenche o perfil do cliente com segmento, oferta, região, público e objetivos, e pode completá-lo aos poucos. Esse contexto, junto dos dados das contas conectadas, torna as análises mais específicas."],
  ["Como os resultados chegam ao meu cliente?", "Com relatórios em PDF, mensagens agendadas pelo seu WhatsApp conectado por QR Code e envio por e-mail. A API oficial é uma alternativa com configuração própria. Existe também uma área autenticada para o cliente acompanhar os resultados aos quais tem acesso."],
  ["Serve para quem cuida dos próprios anúncios?", "Sim. Gestores independentes, agências e equipes internas podem usar a Groow Ads, acompanhando um negócio ou uma carteira de clientes, com acessos e limites definidos pelo plano."],
];

function Pic({ photo, className, sizes, priority }: { photo: SalesPhoto; className: string; sizes: string; priority?: boolean }) {
  return <Image src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} className={className} sizes={sizes} priority={priority} />;
}

function Brand() {
  return <Image src="/brand/groow-ads-color.png" alt="Groow Ads" width={1179} height={212} className={styles.logo} />;
}

export function SalesPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [yearly, setYearly] = useState(false);
  return <div className={styles.site}>
    <a href="#conteudo" className={styles.skipLink}>Pular para o conteúdo</a>
    <MotionDefs />
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" aria-label="Groow Ads, início"><Brand /></Link>
        <nav className={styles.desktopNav} aria-label="Navegação do site">{navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
        <div className={styles.headerActions}>
          <Link href="/entrar" className={styles.login}>Entrar <ArrowUpRight size={15} /></Link>
          <Link href="/criar-conta" className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}>Começar grátis</Link>
          <button className={styles.menuToggle} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="sales-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </div>
      {menuOpen && <nav id="sales-mobile-menu" className={styles.mobileNav} aria-label="Navegação móvel">{navigation.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}<ArrowUpRight size={17} /></a>)}<Link href="/entrar">Entrar na plataforma <ArrowRight size={17} /></Link></nav>}
    </header>

    <main>
      <section id="conteudo" className={styles.hero}>
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div>
            <span className={styles.kicker}>Inteligência de marketing para anúncios</span>
            <h1>Você define onde chegar. <em>A Groow Ads faz o trabalho.</em></h1>
            <p className={styles.lead}>{live ? "Uma IA que conhece o seu negócio, lê as suas contas de anúncios e assume a rotina que hoje consome o seu dia: analisa, cria, ajusta e corrige campanhas dentro dos limites que você definir, e entrega os resultados." : "Uma IA que conhece o seu negócio, lê as suas contas de anúncios e assume a rotina que hoje consome o seu dia. Já trabalha nas análises e nas entregas. A execução nas campanhas vem a seguir, dentro dos limites que você definir."}</p>
            <div className={styles.heroActions}>
              <Link href="/criar-conta" className={`${styles.btn} ${styles.btnPrimary}`}>Testar grátis por 7 dias <ArrowRight size={18} /></Link>
              <a href="#plataforma" className={`${styles.btn} ${styles.btnGhost}`}><Play size={16} /> Ver a plataforma por dentro</a>
            </div>
            <div className={styles.heroNote}><span><Check size={16} /> Sem cartão de crédito</span><span><Check size={16} /> Interface real, dados fictícios</span></div>
          </div>
          <div className={styles.heroVisual}>
            <DeviceShowcase />
          </div>
        </div>
        <div className={styles.wrap}>
          <div className={styles.statusBar}>
            <div><i className={styles.dot} aria-hidden="true" /><span><strong>{live ? "Dashboards, relatórios e entregas" : "Disponível hoje"}</strong>{live ? "Métricas, PDF, mensagem e e-mail, modo apresentação, análise por IA e portal do cliente." : "Análises com IA, relatórios em PDF, entregas agendadas e portal do cliente."}</span></div>
            <div><i className={`${styles.dot} ${live ? "" : styles.dotSoon}`} aria-hidden="true" /><span>{live ? <><strong>Execução nas campanhas</strong>Criar, ajustar e corrigir campanhas por IA, dentro dos limites que você define.</> : <><strong>Em desenvolvimento</strong>Criar, ajustar e corrigir campanhas por IA. Ainda não incluído na oferta.</>}</span></div>
          </div>
        </div>
      </section>

      <section id="problema" className={`${styles.cost} ${styles.light}`}>
        <div className={`${styles.wrap} ${styles.costGrid}`}>
          <div>
            <span className={styles.kicker}>O custo de fazer tudo na mão</span>
            <h2 className={styles.h2}>Seu tempo está sendo gasto <span className={styles.accent}>onde menos rende.</span></h2>
            <p className={styles.lead}>Gestão de anúncios não deveria ser sinônimo de planilha, cópia de números e lembrete de envio. É trabalho necessário, mas repetível. E o que é repetível pode ser delegado.</p>
            <figure className={styles.storyPhoto}><Pic photo={photos.problem} className={styles.storyImg} sizes="(max-width: 1100px) 94vw, 520px" /><figcaption>O trabalho acompanha você até no café.</figcaption></figure>
          </div>
          <div>
            <ul className={styles.costList}>{chores.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}</ul>
            <p className={styles.costClose}>Nenhuma dessas tarefas é a razão pela qual você é bom no que faz.</p>
          </div>
        </div>
      </section>

      <section id="como-funciona" className={styles.way}>
        <div className={styles.wrap}>
          <div className={styles.wayHead}>
            <div><span className={styles.kicker}>Uma nova maneira de trabalhar</span>
            <h2 className={styles.h2}>Informe uma vez. <span className={styles.accent}>Delegue o resto.</span></h2>
            <p className={styles.lead}>Em vez de aprender mais uma ferramenta, você apresenta o negócio, define os limites e deixa a inteligência assumir o trabalho, com transparência sobre o que foi feito.</p></div>
            <div className={styles.wayCore}><CoreMotion /></div>
          </div>
          <div className={styles.steps}>{steps.map(([number, title, text, status, soon]) => <article className={styles.step} key={number}><span className={styles.stepNum} aria-hidden="true">{number}</span><h3>{title}</h3><p>{text}</p><span className={`${styles.tag} ${soon ? styles.tagSoon : ""}`}>{soon ? <Clock3 size={13} /> : <Check size={13} />}{status}</span></article>)}</div>
        </div>
      </section>

      <section className={`${styles.contrast} ${styles.light}`} aria-labelledby="contrast-title">
        <div className={styles.wrap}>
          <div className={styles.contrastHead}><div><span className={styles.kicker}>O que muda na prática</span><h2 className={styles.h2} id="contrast-title">Você comanda. <span className={styles.accent}>A Groow executa.</span></h2><p className={styles.lead}>Você define o objetivo e os limites. O trabalho repetitivo deixa de passar pelas suas mãos.</p></div><figure className={styles.commandPhoto}><Pic photo={photos.command} className={styles.commandImg} sizes="(max-width: 1100px) 94vw, 560px" /></figure></div>
          <div className={styles.contrastTable} role="table" aria-label="Rotina até aqui comparada à rotina com a Groow Ads">
            <div className={styles.contrastRow} role="row"><span role="columnheader">Rotina até aqui</span><span role="columnheader" className={styles.contrastNew}>Com a Groow Ads</span></div>
            {contrast.map(([before, after]) => <div className={styles.contrastRow} role="row" key={before}><p role="cell"><X size={18} aria-hidden="true" />{before}</p><p role="cell" className={styles.contrastNew}><Check size={18} aria-hidden="true" />{after}</p></div>)}
          </div>
        </div>
      </section>

      <section id="plataforma" className={styles.product}>
        <div className={styles.wrap}>
          <div className={styles.productHead}>
            <h2 className={styles.h2}>O produto de verdade. <span className={styles.accent}>Sem ilustração genérica.</span></h2>
            <p className={styles.lead}>Capturas da própria plataforma. Nomes, valores e conversas são demonstrativos; a interface é a que você vai usar.</p>
          </div>
          <ProductShowcase />
        </div>
      </section>

      <section id="demonstracao" className={styles.tourBand}>
        <div className={`${styles.wrap} ${styles.tourSection}`}>
          <div className={styles.tourCopy}><span className={styles.kicker}>Da análise à entrega</span><h2 className={styles.h2}>Veja o caminho, <span className={styles.accent}>na tela real.</span></h2><p className={styles.lead}>Uma gravação da navegação pela análise de um cliente, pelos agendamentos e pelo acompanhamento das entregas.</p><p className={styles.smallNote}>Ambiente demonstrativo. Sem alteração de campanhas, envio de mensagens ou dados de clientes reais.</p></div>
          <ProductTour />
        </div>
      </section>

      <section className={`${styles.board} ${styles.light}`} aria-labelledby="board-title">
        <div className={styles.wrap}>
          <div className={styles.boardHead}><span className={styles.kicker}>{live ? "Na prática" : "Transparência"}</span><h2 className={styles.h2} id="board-title">{live ? <>O que a Groow faz por você. <span className={styles.accent}>Do dado à ação.</span></> : <>O que a Groow já faz. <span className={styles.accent}>E o que vem a seguir.</span></>}</h2><p className={styles.lead}>{live ? "Ela entende o negócio, prepara a análise e executa o trabalho nas campanhas, sempre dentro dos limites que você definiu." : "Você decide com informação completa: separamos o que está disponível do que ainda está sendo construído."}</p></div>
          <div className={styles.boardGrid}>
            <div className={`${styles.boardCol} ${styles.boardNow}`}><span className={styles.tag}><Check size={13} /> {live ? "Analisa e entrega" : "Disponível hoje"}</span><h3>Trabalho que já sai da sua lista</h3><p>{live ? "Do dado ao relatório, sem trabalho manual." : "Incluído nos planos e no teste de 7 dias."}</p><ul>{available.map(item => <li key={item}><Check size={18} />{item}</li>)}</ul></div>
            <div className={`${styles.boardCol} ${styles.boardSoon} ${live ? styles.boardLive : ""}`}><span className={`${styles.tag} ${live ? "" : styles.tagSoon}`}>{live ? <Check size={13} /> : <Clock3 size={13} />} {live ? "Executa nas campanhas" : "Em desenvolvimento"}</span><h3>A execução nas campanhas</h3><p>{live ? "Tudo dentro dos limites que você define." : "Direção do produto. Não está incluída na oferta atual."}</p><ul>{upcoming.map(item => <li key={item}>{live ? <Check size={18} /> : <Clock3 size={18} />}{item}</li>)}</ul></div>
          </div>
          {live && <div className={styles.control}><div><h3>Você no controle</h3><ul>{control.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}</ul></div><figure className={styles.controlPhoto}><Pic photo={photos.control} className={styles.controlImg} sizes="(max-width: 1100px) 94vw, 480px" /></figure></div>}
          <p className={styles.boardFoot}><ShieldCheck size={18} /> {live ? "Cada ação é registrada e respeita as permissões e os limites que você configurou." : "Uma capacidade só passa para “disponível” depois de implementada e validada com as plataformas de anúncios."}</p>
        </div>
      </section>

      <section id="recursos" className={styles.features}>
        <div className={styles.wrap}>
          <div className={styles.featuresHead}><div><span className={styles.kicker}>Recursos da plataforma</span><h2 className={styles.h2}>Tudo o que sustenta o trabalho. <span className={styles.accent}>Pronto para usar.</span></h2></div><p className={styles.lead}>Dashboards, relatórios, mensagens e apresentação: a base que mantém você e o seu cliente sempre bem informados.</p></div>
          <div className={styles.featureGrid}>{features.map(([kind, title, text]) => <article className={styles.feature} key={kind}><Motion kind={kind} /><h3>{title}</h3><p>{text}</p></article>)}</div>
          <div className={styles.spotlight}>
            <figure className={styles.spotPhoto}><Pic photo={photos.meeting} className={styles.spotImg} sizes="(max-width: 1100px) 94vw, 640px" /></figure>
            <div><span className={styles.kicker}>Da tela para a reunião</span><h3>Apresente os resultados sem montar uma apresentação.</h3><p>O modo apresentação abre o painel em tela cheia, e o relatório horizontal em 1920 × 1080 já está pronto para a conversa com o cliente. Quem não estava na sala recebe o PDF, a mensagem no WhatsApp ou o e-mail.</p><ul className={styles.chips}>{["Tela cheia", "Relatório horizontal", "PDF", "WhatsApp", "E-mail"].map(chip => <li key={chip}>{chip}</li>)}</ul></div>
          </div>
        </div>
      </section>
      <section id="planos" className={styles.pricing}>
        <div className={styles.wrap}>
          <div className={styles.pricingHead}><span className={styles.kicker}>Planos</span><h2 className={styles.h2}>{live ? "Comece hoje. " : "Comece pelo que já funciona. "}<span className={styles.accent}>Sem cartão.</span></h2><p className={styles.lead}>{live ? "Sete dias para ver a Groow trabalhando na sua própria rotina." : "Sete dias para experimentar os recursos disponíveis na sua própria rotina."}</p></div>
          <div className={styles.billingToggle} role="group" aria-label="Período de cobrança"><button aria-pressed={!yearly} onClick={() => setYearly(false)}>Mensal</button><button aria-pressed={yearly} onClick={() => setYearly(true)}>Anual <span>2 meses grátis</span></button></div>
          <div className={styles.planGrid}>{plans.map((plan, index) => <article className={`${styles.planCard} ${index === 1 ? styles.recommendedPlan : ""}`} key={plan.name}>{index === 1 && <span className={styles.planBadge}><Sparkles size={13} /> RECOMENDADO</span>}<span className={styles.planName}>{plan.name}</span><p>{plan.description}</p><div className={styles.planPrice}><span>R$</span><strong>{money(yearly ? plan.yearly : plan.monthly)}</strong><span>/{yearly ? "ano" : "mês"}</span></div><small className={styles.planBilling}>{yearly ? "Cobrança anual em pagamento integral. Equivale a 10 mensalidades." : "Cobrança mensal."}</small><Link href="/criar-conta" className={`${styles.btn} ${index === 1 ? styles.btnPrimary : styles.btnGhost}`}>Testar grátis por 7 dias <ArrowRight size={16} /></Link><span className={styles.planIncludes}>Limites do plano</span><ul>{planLimits(plan).map(([title, hint]) => <li key={title}><Check size={17} /><span><strong>{title}</strong><small>{hint}</small></span></li>)}</ul><a href="#incluso" className={styles.planAll}>+ todos os recursos da plataforma <ArrowDown size={15} /></a></article>)}</div>
          <div id="incluso" className={styles.included}><h3>Incluído em todos os planos</h3><ul>{everyPlan.map(item => <li key={item}><Check size={17} />{item}</li>)}</ul></div>
          <p className={styles.planNote}><ShieldCheck size={17} /> {live ? "O investimento em anúncios é separado da assinatura. Recursos e limites completos na área de assinatura." : "O investimento em anúncios é separado da assinatura. A execução autônoma de campanhas está em desenvolvimento e não está incluída nesta oferta. Recursos e limites completos na área de assinatura."}</p>
        </div>
      </section>

      <section id="duvidas" className={`${styles.faq} ${styles.light}`}>
        <div className={`${styles.wrap} ${styles.faqGrid}`}>
          <div><span className={styles.kicker}>Dúvidas</span><h2 className={styles.h2}>Clareza antes de <span className={styles.accent}>começar.</span></h2><p className={styles.lead}>{live ? "O que a Groow faz, o que cada plano inclui e como dar o primeiro passo." : "O que a Groow faz hoje, o que vem depois e como dar o primeiro passo."}</p></div>
          <div className={styles.faqItems}>{questions.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={22} /></summary><p>{answer}</p></details>)}</div>
        </div>
      </section>

      <section className={styles.finalCta}>
        <Pic photo={photos.cta} className={styles.ctaBg} sizes="100vw" /><div className={styles.ctaShade} aria-hidden="true" />
        <div className={`${styles.wrap} ${styles.ctaContent}`}>
          <h2 className={styles.h2}>Menos operação. <span className={styles.accent}>Mais estratégia.</span></h2>
          <p className={styles.lead}>{live ? "Conte o seu negócio, defina os limites e veja a Groow Ads trabalhando na sua rotina." : "Comece com as análises por IA e as entregas agendadas. Veja a Groow Ads trabalhando na sua rotina."}</p>
          <Link href="/criar-conta" className={`${styles.btn} ${styles.btnPrimary}`}>Começar meus 7 dias grátis <ArrowRight size={18} /></Link>
          <small>Sem cartão. Você conhece antes de contratar.</small>
        </div>
      </section>
    </main>

    <footer className={styles.footer}>
      <div className={styles.wrap}>
        <div className={styles.footerTop}><div><Link href="/" aria-label="Groow Ads, início"><Brand /></Link><p>Inteligência para conhecer o negócio.<br />Tecnologia para assumir o trabalho.</p></div><nav aria-label="Links do rodapé">{navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}<Link href="/entrar">Entrar</Link></nav></div>
        <p className={styles.imageNote}>Imagens ilustrativas geradas com inteligência artificial. As interfaces exibidas são da Groow Ads, com dados demonstrativos.</p>
        <div className={styles.footerBottom}><span>© {new Date().getFullYear()} Groow Ads · Uma plataforma da iGrow Digital.</span><div><Link href="/privacidade">Privacidade</Link><Link href="/exclusao-de-dados">Exclusão de dados</Link></div></div>
      </div>
    </footer>
  </div>;
}
