"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Layers, Monitor } from "lucide-react";
import styles from "./sales-page.module.css";

// Réplica animada do dashboard real do cliente (mesma estrutura, títulos e estilo da plataforma).
// Todos os dados são fictícios, os mesmos do ambiente de demonstração. Estado final = estado base.

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useInView<T extends Element>() {
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

export function CountUp({ to, active, decimals = 0, prefix = "", suffix = "", duration = 1800 }: { to: number; active: boolean; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
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

/** Preço que "rola" até o novo valor ao alternar mensal/anual. */
export function AnimatedMoney({ cents }: { cents: number }) {
  const [shown, setShown] = useState(cents);
  const from = useRef(cents);
  useEffect(() => {
    if (reducedMotion()) { const f = requestAnimationFrame(() => { setShown(cents); from.current = cents; }); return () => cancelAnimationFrame(f); }
    const start = performance.now(); const origin = from.current; let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      const value = origin + (cents - origin) * (1 - Math.pow(1 - t, 3));
      setShown(value); from.current = value;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents]);
  return <>{new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(shown / 100)}</>;
}

const wave = (seed: number, n = 24, amp = 1) => Array.from({ length: n }, (_, i) => 0.55 + 0.28 * Math.sin(i * 0.55 + seed) + 0.12 * Math.sin(i * 1.7 + seed * 2) * amp + i * 0.004);
function smooth(values: number[], w: number, h: number, pad = 2) {
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - pad - v * (h - pad * 2)] as const);
  return pts.reduce((d, p, i) => i === 0 ? `M${p[0].toFixed(1)} ${p[1].toFixed(1)}` : `${d} Q${pts[i - 1][0].toFixed(1)} ${pts[i - 1][1].toFixed(1)} ${((pts[i - 1][0] + p[0]) / 2).toFixed(1)} ${((pts[i - 1][1] + p[1]) / 2).toFixed(1)}`, "") + ` T${pts[pts.length - 1][0].toFixed(1)} ${pts[pts.length - 1][1].toFixed(1)}`;
}

function Spark({ seed }: { seed: number }) {
  const d = smooth(wave(seed), 120, 34);
  return <svg className={styles.lvSpark} viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true"><path className={styles.lvSparkArea} d={`${d} L120 34 L0 34 Z`} /><path className={styles.lvSparkLine} d={d} /></svg>;
}

type Metric = { title: string; to: number; decimals?: number; prefix?: string; suffix?: string; delta: string; seed: number };
const row1: Metric[] = [
  { title: "Alcance", to: 162693, delta: "+12,9% vs. anterior", seed: 1 },
  { title: "Impressões", to: 543646, delta: "+25% vs. anterior", seed: 2 },
  { title: "CPM (custo por 1.000 impressões)", to: 7.15, decimals: 2, prefix: "R$ ", delta: "-4,8% vs. anterior", seed: 3 },
  { title: "Cliques no link", to: 6238, delta: "+29,9% vs. anterior", seed: 4 },
  { title: "CTR (taxa de cliques no link)", to: 1.15, decimals: 2, suffix: "%", delta: "+3,9% vs. anterior", seed: 5 },
];
const row2: Metric[] = [
  { title: "CPC (custo por clique no link)", to: 0.62, decimals: 2, prefix: "R$ ", delta: "-8,3% vs. anterior", seed: 6 },
  { title: "Frequência", to: 3.34, decimals: 2, delta: "+10,7% vs. anterior", seed: 7 },
  { title: "Cliques (todos)", to: 10061, delta: "+29,9% vs. anterior", seed: 8 },
  { title: "Engajamento com a publicação", to: 31189, delta: "+29,9% vs. anterior", seed: 9 },
];
const results: [number, string][] = [[42, "cadastros concluídos"], [188, "conversas por mensagem iniciadas"], [1366, "cliques no link"], [967, "visitas ao perfil do instagram"], [45418, "alcance"], [31, "leads"]];
const costs: [number, string][] = [[28.1, "cadastros concluídos"], [4.58, "conversas por mensagem iniciadas"], [0.47, "cliques no link"], [0.43, "visitas ao perfil do instagram"], [0.01, "alcance"], [6.14, "leads"]];
const main = wave(3.1, 30, 1.6), compare = wave(4.4, 30, 2.2).map(v => v * 0.9), previous = wave(2.4, 30, 1.3).map(v => v * 0.78);
const campaignsTable = [
  { name: "Matrículas 2027 · Cadastro", acct: "Escola Horizonte · Principal", spend: 1180.4, result: 42, label: "cadastros concluídos", cost: 28.1 },
  { name: "Visita guiada · Mensagens", acct: "Escola Horizonte · Principal", spend: 860.2, result: 188, label: "conversas por mensagem iniciadas", cost: 4.58 },
  { name: "Tráfego para o site", acct: "Escola Horizonte · Principal", spend: 640, result: 1366, label: "cliques no link", cost: 0.47 },
  { name: "Instagram · Perfil", acct: "Escola Horizonte · Unidade 2", spend: 420.6, result: 967, label: "visitas ao perfil do instagram", cost: 0.43 },
];
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function Donut({ parts, center, label }: { parts: { name: string; value: string; pct: number; color: string }[]; center: string; label: string }) {
  const offsets = parts.map((_, i) => parts.slice(0, i).reduce((sum, item) => sum + item.pct, 0));
  return <div className={styles.lvDonutRow}>
    <div className={styles.lvDonutBox}>
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle className={styles.lvRingBase} cx="60" cy="60" r="46" />{parts.map((part, i) => <circle key={part.name} className={styles.lvRing} style={{ stroke: part.color, strokeDasharray: `${part.pct} 100`, strokeDashoffset: -offsets[i] }} cx="60" cy="60" r="46" pathLength="100" />)}</svg>
      <div className={styles.lvDonutCenter}><strong>{center}</strong><span>{label}</span></div>
    </div>
    <ul className={styles.lvLegend}>{parts.map(part => <li key={part.name}><i style={{ background: part.color }} /><span>{part.name}</span><b>{part.value}</b></li>)}</ul>
  </div>;
}

export function LiveDashboard() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const w = 600, h = 200;
  return <div ref={ref} className={`${styles.live} ${seen ? styles.liveOn : ""}`}>
    <div className={styles.lvBar}><span className={styles.lvDots}><i /><i /><i /></span><span>GROOW ADS / PAINEL DO CLIENTE</span><span className={styles.lvDemo}>DEMONSTRAÇÃO</span></div>
    <div className={styles.lvBody}>
      <div className={styles.lvHead}>
        <div className={styles.lvClient}><span className={styles.lvAvatar}>EH</span><h3>Escola Horizonte</h3></div>
        <div className={styles.lvActions}><span><Layers size={14} /> 2 plataformas <ChevronDown size={13} /></span><span><Monitor size={14} /> Apresentar</span><span><Download size={14} /> Exportar PDF <ChevronDown size={13} /></span></div>
      </div>
      <div className={styles.lvPeriod}><span>05 de set. de 2026 – 04 de out. de 2026</span><span className={styles.lvUpdated}><i /> Atualizado em 05/10, 06:00</span></div>
      <div className={styles.lvPlatform}><b>∞</b> Meta Ads <small>2 contas</small></div>

      <div className={styles.lvTop}>
        <div className={styles.lvCard}><h4>Valor usado</h4><strong className={styles.lvBig}><CountUp to={3885.18} active={seen} decimals={2} prefix="R$ " /></strong><em className={styles.lvGood}>↗ +19% vs. anterior</em><Spark seed={0.4} /></div>
        <div className={styles.lvCard}><h4>Resultados</h4><ul className={styles.lvList}>{results.map(([value, label]) => <li key={label}><strong><CountUp to={value} active={seen} /></strong><span>{label}</span></li>)}</ul></div>
        <div className={styles.lvCard}><h4>Custo por resultado</h4><ul className={styles.lvList}>{costs.map(([value, label]) => <li key={label}><strong><CountUp to={value} active={seen} decimals={2} prefix="R$ " /></strong><span>{label}</span></li>)}</ul></div>
      </div>

      <div className={styles.lvKpis5}>{row1.map(m => <div key={m.title} className={styles.lvCard}><h4>{m.title}</h4><strong className={styles.lvMid}><CountUp to={m.to} active={seen} decimals={m.decimals} prefix={m.prefix} suffix={m.suffix} /></strong><em className={styles.lvGood}>↗ {m.delta}</em><Spark seed={m.seed} /></div>)}</div>
      <div className={styles.lvKpis4}>{row2.map(m => <div key={m.title} className={styles.lvCard}><h4>{m.title}</h4><strong className={styles.lvMid}><CountUp to={m.to} active={seen} decimals={m.decimals} prefix={m.prefix} /></strong><em className={styles.lvGood}>↗ {m.delta}</em><Spark seed={m.seed} /></div>)}</div>

      <div className={styles.lvChartRow}>
        <div className={styles.lvCard}>
          <div className={styles.lvCardHead}><h4>Desempenho do período</h4><span className={styles.lvSwitch}><b>Linhas</b><i>Barras</i></span></div>
          <div className={styles.lvPickers}><span>Principal <b>Valor usado</b></span><span>Comparar com <b>Cadastros concluídos</b></span></div>
          <svg className={styles.lvChart} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Gráfico demonstrativo do desempenho do período">
            {[0, 1, 2, 3, 4].map(i => <line key={i} className={styles.liveGrid} x1="0" x2={w} y1={10 + i * 45} y2={10 + i * 45} />)}
            <path className={`${styles.lvLine} ${styles.lvLinePrev}`} d={smooth(previous, w, h, 14)} />
            <path className={styles.lvArea} d={`${smooth(main, w, h, 14)} L${w} ${h} L0 ${h} Z`} />
            <path className={`${styles.lvLine} ${styles.lvLineCmp}`} d={smooth(compare, w, h, 14)} />
            <path className={`${styles.lvLine} ${styles.lvLineMain}`} d={smooth(main, w, h, 14)} />
          </svg>
          <div className={styles.lvLegendRow}><span><i style={{ background: "#4f6bf0" }} />Valor usado</span><span><i style={{ background: "#2cc4cf" }} />Cadastros concluídos</span><span><i className={styles.lvDash} />Período anterior</span></div>
        </div>
        <div className={styles.lvCard}>
          <div className={styles.lvCardHead}><h4>Investimento por conta</h4></div>
          <Donut center="R$ 3.885,18" label="2 contas" parts={[{ name: "Escola Horizonte · Principal", value: "R$ 2.964,28", pct: 76.3, color: "#4f6bf0" }, { name: "Escola Horizonte · Unidade 2", value: "R$ 920,90", pct: 23.7, color: "#2cc4cf" }]} />
        </div>
      </div>

      <div className={styles.lvAudHead}><h4>Público do período</h4><span>Plataformas, gênero, idade e local, direto da Meta</span></div>
      <div className={styles.lvAud}>
        <div className={styles.lvCard}><h4>Plataformas</h4><Donut center="488,9 mil" label="Impressões" parts={[{ name: "Instagram", value: "348,2 mil", pct: 71.2, color: "#c35ad9" }, { name: "Facebook", value: "131,4 mil", pct: 26.9, color: "#4f6bf0" }, { name: "Audience Network", value: "6,9 mil", pct: 1.4, color: "#f0b429" }, { name: "WhatsApp", value: "2,4 mil", pct: 0.5, color: "#3ecf8e" }]} /></div>
        <div className={styles.lvCard}><h4>Gênero</h4><Donut center="488,9 mil" label="Impressões" parts={[{ name: "Mulheres", value: "360,4 mil", pct: 73.7, color: "#e8618c" }, { name: "Homens", value: "126,2 mil", pct: 25.8, color: "#5b9cf5" }, { name: "Não informado", value: "2,3 mil", pct: 0.5, color: "#7d8799" }]} /></div>
      </div>

      <div className={styles.lvTableCard}>
        <div className={styles.lvCardHead}><h4>Seleção incluída na análise <small>8</small></h4></div>
        <div className={styles.lvTable}>
          <div className={`${styles.lvTr} ${styles.lvTh}`}><span>Campanha</span><span>Valor usado</span><span>Resultados</span><span>Custo por resultado</span></div>
          {campaignsTable.map((c, i) => <div className={styles.lvTr} key={c.name} style={{ animationDelay: `${0.5 + i * 0.12}s` }}><span><b>{c.name}</b><small>{c.acct}</small></span><span><CountUp to={c.spend} active={seen} decimals={2} prefix="R$ " /></span><span><CountUp to={c.result} active={seen} /><small>{c.label}</small></span><span>{brl(c.cost)}<small>{c.label}</small></span></div>)}
        </div>
      </div>
      <p className={styles.lvFoot}>Dados fictícios de demonstração. A interface é a do painel do cliente da Groow Ads.</p>
    </div>

  </div>;
}
