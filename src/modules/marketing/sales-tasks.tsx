"use client";

import { useEffect, useState } from "react";
import { Check, Clock3 } from "lucide-react";
import { useInView } from "./sales-live";
import styles from "./sales-page.module.css";

// Ilustração da rotina manual: as tarefas se acumulam e, depois, a Groow as resolve.
// Sem números de tempo ou de resultado: apenas a contagem das quatro tarefas da lista ao lado.

const tasks = ["Abrir conta por conta", "Copiar números para o relatório", "Lembrar quem recebe o quê", "Responder “como estão os anúncios?”"];
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function TaskPile() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [shown, setShown] = useState(tasks.length);
  const [done, setDone] = useState(tasks.length);
  useEffect(() => {
    if (!seen || reduced()) return;
    let cancelled = false; const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>(resolve => { timers.push(setTimeout(resolve, ms)); });
    (async () => {
      while (!cancelled) {
        setShown(0); setDone(0); await wait(900);
        for (let i = 1; i <= tasks.length && !cancelled; i++) { setShown(i); await wait(850); }
        await wait(1500);
        for (let i = 1; i <= tasks.length && !cancelled; i++) { setDone(i); await wait(650); }
        await wait(3600);
      }
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [seen]);
  const pending = shown - done;
  const clear = shown === tasks.length && done === tasks.length;
  return <div ref={ref} className={styles.tasks} role="img" aria-label="Ilustração: as tarefas manuais do dia se acumulam e a Groow as resolve, deixando zero pendentes">
    <div className={styles.tkHead}><strong>Tarefas do dia</strong><span className={`${styles.tkBadge} ${clear ? styles.tkClear : pending > 0 ? styles.tkPending : ""}`}>{clear ? "0 pendentes" : `${pending} ${pending === 1 ? "pendente" : "pendentes"}`}</span></div>
    <ul className={styles.tkList}>
      {tasks.map((task, i) => i < shown && <li key={task} className={i < done ? styles.tkDone : ""}><span className={styles.tkIcon}>{i < done ? <Check size={14} /> : <Clock3 size={14} />}</span><span className={styles.tkText}>{task}</span>{i < done && <em>Feito pela Groow</em>}</li>)}
    </ul>
    <small>Exemplo ilustrativo</small>
  </div>;
}
