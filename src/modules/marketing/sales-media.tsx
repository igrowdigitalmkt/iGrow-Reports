"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { ArrowUpRight, CalendarClock, ChartNoAxesCombined, FileText, LayoutDashboard, Maximize2, MessageCircle, Play, X } from "lucide-react";
import styles from "./sales-page.module.css";

const screens = [
  { key: "overview", label: "Visão geral", icon: LayoutDashboard, title: "Encontre o que pede atenção sem abrir conta por conta.", text: "Investimento, resultados e clientes com pontos de atenção na mesma visão da carteira.", alt: "Visão geral real da Groow Ads: investimento diário, resultados e clientes que precisam de atenção" },
  { key: "analytics", label: "Análise de campanhas", icon: ChartNoAxesCombined, title: "Leia os resultados com o contexto de cada conta.", text: "Períodos, plataformas, contas e indicadores no painel do cliente. Os dados dão base à análise.", alt: "Painel real de análise do cliente na Groow Ads, com filtros, saldo e resultados por conta" },
  { key: "automations", label: "Agendamentos", icon: CalendarClock, title: "Uma entrega recorrente não precisa virar mais um lembrete.", text: "A frequência, os destinatários e o conteúdo ficam organizados em uma rotina de envio.", alt: "Tela real de agendamentos da Groow Ads com rotinas de envio e clientes demonstrativos" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, title: "O resultado chega onde a conversa já acontece.", text: "Seu número conectado, conversas, etiquetas e histórico. A comunicação faz parte da entrega.", alt: "WhatsApp real da Groow Ads com etiquetas e conversa demonstrativa sobre um relatório" },
  { key: "reports", label: "Relatórios", icon: FileText, title: "Acompanhe a entrega, além de preparar o relatório.", text: "Visão dos envios, entregas, modelos e PDFs dos clientes no módulo de relatórios.", alt: "Módulo real de relatórios da Groow Ads com indicadores de envios e entregas" },
];

export function DeviceShowcase() {
  return <div className={styles.deviceStage} aria-label="Groow Ads em computador, tablet e celular">
    <div className={styles.deviceHalo} aria-hidden="true" />
    <div className={styles.computer}>
      <div className={styles.computerScreen}><Image src="/product/hero-desktop.webp" alt="Interface real da Groow Ads no computador, em tema claro, com os indicadores e o gráfico do período de um cliente fictício" width={1600} height={900} sizes="(max-width: 760px) 94vw, 78vw" preload /></div>
      <div className={styles.computerChin} aria-hidden="true"><span /></div><div className={styles.computerStand} aria-hidden="true" />
    </div>
    <div className={styles.tablet}><Image src="/product/hero-tablet.webp" alt="Painel do cliente da Groow Ads no tablet, com público do período e campanhas, dados fictícios" width={1024} height={1366} sizes="(max-width: 760px) 27vw, 25vw" /></div>
    <div className={styles.phone}><div className={styles.phoneCamera} aria-hidden="true" /><Image src="/product/hero-mobile.webp" alt="Versão móvel real da Groow Ads, com o valor usado e os resultados de um cliente fictício" width={780} height={1688} sizes="(max-width: 760px) 17vw, 15vw" /><div className={styles.phoneBar} aria-hidden="true" /></div>
    <span className={styles.deviceAnnotation}><span /> O mesmo negócio. Na tela que está com você.</span>
  </div>;
}

export function ProductShowcase() {
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = screens[active];
  return <div className={styles.showcase}>
    <div className={styles.previewTabs} role="tablist" aria-label="Explore as telas reais da plataforma">{screens.map((screen, index) => <button key={screen.key} id={`product-tab-${index}`} role="tab" aria-selected={active === index} tabIndex={active === index ? 0 : -1} aria-controls="product-preview-panel" onClick={() => setActive(index)} onKeyDown={event => {
      const target = event.key === "ArrowRight" ? (index + 1) % screens.length : event.key === "ArrowLeft" ? (index + screens.length - 1) % screens.length : event.key === "Home" ? 0 : event.key === "End" ? screens.length - 1 : null;
      if (target !== null) { event.preventDefault(); setActive(target); document.getElementById(`product-tab-${target}`)?.focus(); }
    }}><screen.icon size={16} />{screen.label}</button>)}</div>
    <div id="product-preview-panel" role="tabpanel" aria-labelledby={`product-tab-${active}`} className={styles.screenPanel}>
      <div className={styles.screenCopy} key={`copy-${current.key}`}><div><span className={styles.screenIndex}>0{active + 1} / 05</span><h3>{current.title}</h3><p>{current.text}</p></div><button onClick={() => dialog.current?.showModal()} className={styles.zoomButton}><Maximize2 size={16} /> Ampliar tela <ArrowUpRight size={14} /></button></div>
      <div className={styles.browserFrame}><div className={styles.browserBar} aria-hidden="true"><span><i /><i /><i /></span><span>GROOW ADS / {current.label.toUpperCase()}</span><span>DEMONSTRAÇÃO</span></div><Image key={current.key} src={`/product/${current.key}.webp`} alt={current.alt} width={1440} height={1000} sizes="(max-width: 760px) 94vw, 1120px" className={styles.captureImage} /></div>
      <p className={styles.demoCaption}>Captura da interface real em modo de demonstração. Nomes, campanhas, valores e conversas fictícios.</p>
    </div>
    <dialog ref={dialog} className={styles.screenDialog} aria-labelledby="expanded-screen-title" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className={styles.dialogBar}><h3 id="expanded-screen-title">{current.label} · interface real</h3><button onClick={() => dialog.current?.close()} aria-label="Fechar tela ampliada"><X size={22} /></button></div>
      <div className={styles.expandedImage}><Image src={`/product/${current.key}.webp`} alt={current.alt} width={1440} height={1000} sizes="1440px" /></div>
      <p>Dados demonstrativos. No celular, deslize a imagem para ver os detalhes.</p>
    </dialog>
  </div>;
}

export function ProductTour() {
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className={styles.tour}>
    <div className={styles.videoFrame}>
      {started && !failed ? <video controls autoPlay playsInline preload="metadata" poster="/product/analytics.webp" aria-label="Tour gravado da interface real da Groow Ads" onError={() => setFailed(true)}>
        <source src="/product/tour.webm" type="video/webm" />
        <source src="/product/tour.mp4" type="video/mp4" onError={() => setFailed(true)} />
        <track kind="captions" src="/product/tour.vtt" srcLang="pt-BR" label="Português: descrição das telas" default />
        Seu navegador não suporta vídeo. Use a descrição abaixo.
      </video> : <><Image src="/product/analytics.webp" alt="Prévia da gravação real: análise dos anúncios do cliente Escola Horizonte, um exemplo fictício" width={1440} height={1000} sizes="(max-width: 760px) 94vw, 62vw" /><button className={styles.videoPlay} onClick={() => { setFailed(false); setStarted(true); }} aria-label={failed ? "Tentar reproduzir demonstração novamente" : "Reproduzir demonstração da plataforma"}><span><Play size={27} fill="currentColor" /></span><strong>{failed ? "Tentar novamente" : "Assistir à demonstração"}</strong><small>Gravação real · sem áudio</small></button></>}
    </div>
    {failed && <p role="status" className={styles.smallNote}>Não foi possível carregar o vídeo. <a href="/product/tour.mp4">Abrir a gravação</a> ou consultar a descrição abaixo.</p>}
    <details className={styles.tourTranscript}><summary>O que aparece no vídeo <span>+</span></summary><p>Primeiro, o painel do cliente Escola Horizonte mostra período, contas, saldo e resultados. A gravação percorre a página. Depois, a tela de agendamentos apresenta as rotinas de mensagens. Por fim, o módulo de relatórios mostra o acompanhamento das entregas. A gravação é de um ambiente local demonstrativo: nenhuma campanha é alterada e nenhuma mensagem é enviada. Não há narração.</p></details>
  </div>;
}
