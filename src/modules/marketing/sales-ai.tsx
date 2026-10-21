"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Loader2, PanelRightClose, Send, Sparkles } from "lucide-react";
import { useInView } from "./sales-live";
import styles from "./sales-page.module.css";

// Réplicas animadas do Assistente Groow (chat) e da Análise operacional com IA (sugestões e aprovação).
// Mesma estrutura e textos de interface da plataforma. Dados fictícios, os mesmos do painel de demonstração.
// Com movimento reduzido, mostram o estado final, parado.

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const dialogs = [
  { q: "Onde o investimento está concentrado?", a: "Matrículas 2027 · Cadastro concentrou 30,4% do investimento do período: R$ 1.180,40 de R$ 3.885,18. Essa campanha gerou 42 cadastros concluídos, a R$ 28,10 cada." },
  { q: "Qual campanha traz mensagens mais baratas?", a: "Visita guiada · Mensagens: R$ 4,58 por conversa iniciada, com 188 conversas em R$ 860,20. É o menor custo por mensagem entre as campanhas selecionadas." },
];

export function ChatDemo() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; text: string }[]>(() => [{ role: "user", text: dialogs[0].q }, { role: "assistant", text: dialogs[0].a }]);
  const [typing, setTyping] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!seen || reduced()) return;
    let cancelled = false; const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>(resolve => { timers.push(setTimeout(resolve, ms)); });
    (async () => {
      let round = 0;
      while (!cancelled) {
        const d = dialogs[round % dialogs.length];
        setMsgs([]); setTyping(false); setDraft("");
        await wait(700);
        for (let i = 1; i <= d.q.length && !cancelled; i++) { setDraft(d.q.slice(0, i)); await wait(32); }
        await wait(450); if (cancelled) return;
        setDraft(""); setMsgs([{ role: "user", text: d.q }]); setTyping(true);
        await wait(1300); if (cancelled) return;
        setTyping(false);
        const words = d.a.split(" ");
        for (let i = 1; i <= words.length && !cancelled; i++) { setMsgs([{ role: "user", text: d.q }, { role: "assistant", text: words.slice(0, i).join(" ") }]); await wait(75); }
        await wait(5200); round++;
      }
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [seen]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs, typing]);

  return <div ref={ref} className={styles.chat}>
    <header className={styles.chHead}><span className={styles.chMark}><Sparkles size={15} /></span><strong>Assistente Groow</strong><em>IA</em><em>Consultivo</em><PanelRightClose size={16} className={styles.chCollapse} /></header>
    <section className={styles.chContext}><span>ANALISANDO:</span><div><small>Cliente</small><strong>Escola Horizonte</strong><span>Meta Ads · Escola Horizonte · Principal, Escola Horizonte · Unidade 2</span><span>05/09/2026 a 04/10/2026</span></div></section>
    <div className={styles.chLog} ref={log} role="log" aria-label="Conversa de demonstração">
      {msgs.map((m, i) => <article key={`${m.role}-${i}`} className={`${styles.chMsg} ${m.role === "user" ? styles.chUser : styles.chBot}`}>{m.role === "assistant" && <span className={styles.chWho}><Sparkles size={11} />Assistente Groow</span>}<div>{m.text}{m.role === "assistant" && seen && !reduced() && <i className={styles.chCaret} />}</div></article>)}
      {typing && <div className={styles.chTyping} role="status"><span /><span /><span /></div>}
    </div>
    <footer className={styles.chComposer}><div className={styles.chRow}><div className={styles.chInput}>{draft || <span>Pergunte sobre este contexto…</span>}{draft && <i className={styles.chCaret} />}</div><span className={`${styles.chSend} ${draft ? styles.chSendOn : ""}`}><Send size={16} /></span></div></footer>
  </div>;
}

const FINAL = 5;
export function OpportunitiesDemo() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [step, setStep] = useState(FINAL);
  useEffect(() => {
    if (!seen || reduced()) return;
    let cancelled = false; const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>(resolve => { timers.push(setTimeout(resolve, ms)); });
    (async () => {
      while (!cancelled) {
        setStep(0); await wait(1400); if (cancelled) return;
        setStep(1); await wait(700); if (cancelled) return;
        setStep(2); await wait(2300); if (cancelled) return;
        setStep(3); await wait(1500); if (cancelled) return;
        setStep(4); await wait(2600); if (cancelled) return;
        setStep(5); await wait(5200);
      }
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [seen]);

  const running = step === 2;
  return <div ref={ref} className={styles.opp}>
    <div className={styles.opHead}><span className={styles.opTitle}><Sparkles size={15} /> Análise operacional com IA <em>IA</em></span>{step === 4 && <span className={styles.opChip}>1 aguardando aprovação</span>}</div>
    <div className={styles.opRun}><span className={`${styles.opBtn} ${step === 1 ? styles.opPress : ""} ${running ? styles.opBusy : ""}`}>{running ? <><Loader2 size={14} className={styles.opSpin} /> Analisando… pode levar alguns instantes</> : <><Sparkles size={14} /> Analisar oportunidades</>}</span></div>
    <div className={styles.opStages}>
      {step >= 3 && <section className={`${styles.opStage} ${styles.opIn}`}><header><h4>Observação <span>1</span></h4><small>O que a IA percebeu nos dados</small></header><ul><li><strong>Visita guiada · Mensagens</strong><span>Custo por conversa 18% abaixo da meta há 5 dias, com volume estável.</span></li></ul></section>}
      {step >= 3 && <section className={`${styles.opStage} ${styles.opIn}`} style={{ animationDelay: ".15s" }}><header><h4>Recomendação <span>1</span></h4><small>Resumo da análise</small></header><ul><li><span>Há espaço para escalar a campanha de mensagens dentro do teto mensal definido.</span><small>agora · pedida manualmente</small></li></ul></section>}
      {step >= 4 && <section className={`${styles.opStage} ${styles.opIn} ${step === 4 ? styles.opAwait : ""}`}><header><h4>{step === 4 ? "Aguardando aprovação" : "Executado"} <span>1</span></h4><small>{step === 4 ? "Uma pessoa precisa aprovar antes de qualquer alteração" : "Aplicado e conferido na plataforma"}</small></header><ul><li><strong>Ajustar orçamento diário: Visita guiada · Mensagens</strong><span>De R$ 120,00 para R$ 150,00 por dia. Gasto confirmado no período selecionado: <b>R$ 860,20</b>.</span><small className={styles.opReason}>Motivo: custo por conversa abaixo da meta. Dentro do teto mensal.</small><small>Escola Horizonte · Principal · agora · proposta da IA{step === 5 ? " · aprovada por uma pessoa e confirmada na Meta" : ""}</small>{step === 4 ? <span className={styles.opLink}>Revisar e aprovar <ChevronRight size={13} /></span> : <span className={styles.opDone}><Check size={14} /> Aplicada e conferida na plataforma</span>}</li></ul></section>}
    </div>
  </div>;
}
