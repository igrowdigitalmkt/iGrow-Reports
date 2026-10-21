"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Check, MessageCircle, Pause, SlidersHorizontal, Sparkles } from "lucide-react";
import styles from "./sales-page.module.css";

// Painel animado da plataforma. Todos os dados são fictícios e identificados como demonstração.
// Estado final = estado base: com movimento reduzido tudo aparece completo e parado.

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || typeof IntersectionObserver === "undefined") { const frame = requestAnimationFrame(() => setSeen(true)); return () => cancelAnimationFrame(frame); }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setSeen(true); observer.disconnect(); } }, { threshold: 0, rootMargin: "0px 0px -12% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, seen] as const;
}

function CountUp({ to, active, decimals = 0, prefix = "", suffix = "", duration = 1800 }: { to: number; active: boolean; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) return;
    const instant = reducedMotion();
    let frame = 0; const start = performance.now();
    const tick = (now: number) => {
      const t = instant ? 1 : Math.min(1, (now - start) / duration);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, duration]);
  const text = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(to * progress);
  return <span>{prefix}{text}{suffix}</span>;
}

const kpis = [
  { label: "Investimento", to: 48320, prefix: "R$ ", decimals: 0, delta: "+8,5%" },
  { label: "Alcance", to: 1.24, suffix: " mi", decimals: 2, delta: "+12,1%" },
  { label: "Leads", to: 1847, decimals: 0, delta: "+23,4%" },
  { label: "Custo por lead", to: 26.16, prefix: "R$ ", decimals: 2, delta: "-9,7%" },
];
const days = [32, 40, 36, 52, 48, 61, 55, 66, 59, 72, 68, 80, 74, 86, 78, 90, 84, 96, 88, 99];
const line = days.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (days.length - 1)) * 300} ${100 - v * 0.9}`).join(" ");
const feed = [
  { icon: SlidersHorizontal, text: "Orçamento do conjunto “Remarketing” ajustado de R$ 120 para R$ 150 por dia, dentro do teto definido.", who: "Órbita Fit" },
  { icon: Pause, text: "Anúncio com CTR abaixo da meta pausado. Motivo registrado no histórico.", who: "Verde & Grão" },
  { icon: MessageCircle, text: "Relatório da semana enviado pelo WhatsApp, entrega confirmada.", who: "Escola Horizonte" },
  { icon: Sparkles, text: "Análise do período pronta: custo por lead caiu e há espaço para escalar.", who: "Casa Nativa" },
  { icon: BellRing, text: "Saldo da conta abaixo de 3 dias de veiculação: alerta enviado ao responsável.", who: "Órbita Fit" },
];

const campaigns = [
  { name: "Matrícula 2027 · Conversão", spend: 18400, leads: 742, cpl: 24.8, bar: 92 },
  { name: "Remarketing · Visitantes", spend: 9300, leads: 411, cpl: 22.63, bar: 78 },
  { name: "Aula experimental · Tráfego", spend: 12100, leads: 436, cpl: 27.75, bar: 61 },
  { name: "Institucional · Alcance", spend: 8520, leads: 258, cpl: 33.02, bar: 38 },
];
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function ApprovalStack({ active }: { active: boolean }) {
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (!active) return;
    if (reducedMotion()) { const f = requestAnimationFrame(() => setApplied(true)); return () => cancelAnimationFrame(f); }
    const id = setTimeout(() => setApplied(true), 3400);
    return () => clearTimeout(id);
  }, [active]);
  return <div className={styles.stack}>
    <div className={`${styles.stackCard} ${styles.stackBack2}`} aria-hidden="true" />
    <div className={`${styles.stackCard} ${styles.stackBack1}`} aria-hidden="true" />
    <div className={styles.stackCard}>
      <div className={styles.stackTop}><Sparkles size={14} /> Sugestão da Groow<span>agora</span></div>
      <p>Aumentar o orçamento de <b>Remarketing · Visitantes</b> de <b>R$ 120</b> para <b>R$ 150</b> por dia.</p>
      <div className={styles.stackWhy}>Motivo: custo por lead 18% abaixo da meta há 5 dias. Dentro do teto mensal definido.</div>
      <div className={styles.stackActions}>
        {applied ? <span className={styles.stackDone}><Check size={15} /> Aplicada e conferida na plataforma</span> : <><span className={styles.stackApprove}>Aprovar</span><span className={styles.stackGhost}>Ignorar</span></>}
      </div>
    </div>
  </div>;
}

export function LiveDashboard() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!seen || reducedMotion()) return;
    const id = setInterval(() => setTick(t => t + 1), 3200);
    return () => clearInterval(id);
  }, [seen]);
  const visible = [0, 1, 2].map(i => feed[(tick + i) % feed.length]);
  return <div ref={ref} className={`${styles.live} ${seen ? styles.liveOn : ""}`}>
    <div className={styles.liveHead}><span className={styles.liveDot} aria-hidden="true" /> Painel de demonstração · dados fictícios<span className={styles.liveTag}>Ao vivo</span></div>
    <div className={styles.liveKpis}>{kpis.map(kpi => <div key={kpi.label} className={styles.liveKpi}><span>{kpi.label}</span><strong><CountUp to={kpi.to} active={seen} decimals={kpi.decimals} prefix={kpi.prefix} suffix={kpi.suffix} /></strong><em className={kpi.delta.startsWith("-") ? styles.liveGood : styles.liveGood}>{kpi.delta} vs. período anterior</em></div>)}</div>
    <div className={styles.liveMain}>
      <div className={styles.liveChart}>
        <div className={styles.liveChartTitle}>Investimento e resultados por dia<span>últimos 20 dias</span></div>
        <svg viewBox="0 0 300 110" preserveAspectRatio="none" role="img" aria-label="Gráfico demonstrativo de resultados crescendo ao longo de 20 dias">
          {[0, 1, 2, 3].map(i => <line key={i} className={styles.liveGrid} x1="0" x2="300" y1={12 + i * 28} y2={12 + i * 28} />)}
          {days.map((v, i) => <rect key={i} className={styles.liveBar} style={{ animationDelay: `${i * 0.05}s` }} x={i * 15 + 2} y={100 - v * 0.55} width="9" height={v * 0.55} rx="2" />)}
          <path className={styles.liveArea} d={`${line} L300 100 L0 100 Z`} />
          <path className={styles.liveLine} d={line} pathLength="1" />
        </svg>
      </div>
      <div className={styles.liveDonut}>
        <div className={styles.liveChartTitle}>Origem dos resultados</div>
        <svg viewBox="0 0 120 120" role="img" aria-label="Gráfico demonstrativo de origem dos resultados: Instagram 58%, WhatsApp 27%, Facebook 15%">
          <circle className={styles.liveRingBase} cx="60" cy="60" r="44" />
          <circle className={`${styles.liveRing} ${styles.liveRing1}`} cx="60" cy="60" r="44" pathLength="100" />
          <circle className={`${styles.liveRing} ${styles.liveRing2}`} cx="60" cy="60" r="44" pathLength="100" />
          <circle className={`${styles.liveRing} ${styles.liveRing3}`} cx="60" cy="60" r="44" pathLength="100" />
        </svg>
        <ul className={styles.liveLegend}><li><i style={{ background: "#c471ed" }} />Instagram <b><CountUp to={58} active={seen} suffix="%" /></b></li><li><i style={{ background: "#5bd6a0" }} />WhatsApp <b><CountUp to={27} active={seen} suffix="%" /></b></li><li><i style={{ background: "#6f89ff" }} />Facebook <b><CountUp to={15} active={seen} suffix="%" /></b></li></ul>
      </div>
    </div>
    <div className={styles.liveTable}>
      <div className={styles.liveChartTitle}>Campanhas do período<span>demonstração</span></div>
      <div className={styles.liveRows}>
        <div className={`${styles.liveRow} ${styles.liveRowHead}`}><span>Campanha</span><span>Investimento</span><span>Leads</span><span>Custo por lead</span><span>Desempenho</span></div>
        {campaigns.map((c, i) => <div className={styles.liveRow} key={c.name}><span>{c.name}</span><span><CountUp to={c.spend} active={seen} prefix="R$ " /></span><span><CountUp to={c.leads} active={seen} /></span><span>{brl(c.cpl)}</span><span className={styles.liveMeter}><i style={{ width: `${c.bar}%`, animationDelay: `${0.4 + i * 0.15}s` }} /></span></div>)}
      </div>
    </div>
    <div className={styles.liveBottom}>
    <div className={styles.liveFeedWrap}>
      <div className={styles.liveChartTitle}>O que a Groow fez agora<span>registro de ações</span></div>
      <ul className={styles.liveFeed} aria-live="off">{visible.map((item, i) => <li key={`${tick}-${i}`} style={{ animationDelay: `${i * 0.12}s` }}><item.icon size={16} /><span>{item.text}<small>{item.who}</small></span><Check size={15} className={styles.liveCheck} /></li>)}</ul>
    </div>
    <div className={styles.liveApproval}><div className={styles.liveChartTitle}>Você aprova o que quiser<span>exemplo</span></div><ApprovalStack active={seen} /></div>
    </div>
  </div>;
}
