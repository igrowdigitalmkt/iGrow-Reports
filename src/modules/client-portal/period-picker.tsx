"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, firstOfMonth, leftMonthFor, monthGrid, monthTitle, pickDay, rangeDays, rangeLabel, WEEKDAYS } from "./period-calendar";
import { PERIOD_SHORTCUTS, presetRange } from "./range";

type Selection = { period: string; from: string; to: string };
const MAX_DAYS = 370;

/**
 * Seletor de periodo: botao com o intervalo, lista de atalhos a esquerda e calendario duplo a direita.
 * Escolher atalho ou dias so prepara a selecao; "Aplicar" confirma e "Cancelar" descarta.
 */
export function PeriodPicker({ period, dateFrom, dateTo, today, disabled = false, onApply }: {
  period: string; dateFrom: string; dateTo: string;
  /** Hoje (AAAA-MM-DD) no fuso da conta: dias futuros ficam bloqueados. */
  today: string; disabled?: boolean; onApply: (selection: Selection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Selection>({ period, from: dateFrom, to: dateTo });
  const [anchor, setAnchor] = useState<string | null>(null);
  const [leftMonth, setLeftMonth] = useState(() => leftMonthFor(dateFrom, today));
  const root = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  function openPicker() {
    setPending({ period, from: dateFrom, to: dateTo });
    setAnchor(null);
    setLeftMonth(leftMonthFor(dateFrom, today));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function choosePreset(key: string) {
    const range = presetRange(key, today);
    if (!range) return;
    setPending({ period: key, from: range.dateFrom, to: range.dateTo });
    setAnchor(null);
    setLeftMonth(leftMonthFor(range.dateFrom, today));
  }

  function chooseDay(day: string) {
    if (day > today) return;
    const next = pickDay({ anchor, from: pending.from, to: pending.to }, day);
    setAnchor(next.anchor);
    setPending({ period: "custom", from: next.from, to: next.to });
  }

  const days = rangeDays(pending.from, pending.to);
  const tooLong = days > MAX_DAYS;
  const months = [leftMonth, addMonths(leftMonth, 1)];

  return <div className="period-picker" ref={root}>
    <button type="button" className="period-picker-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={popoverId}
      disabled={disabled} onClick={() => (open ? setOpen(false) : openPicker())}>
      <CalendarRange size={16} /><span>{rangeLabel(dateFrom, dateTo)}</span>
    </button>
    {open && <div className="period-picker-popover" id={popoverId} role="dialog" aria-label="Escolher período">
      <div className="period-picker-presets">
        <p>Período</p>
        <ul>{PERIOD_SHORTCUTS.map(item => <li key={item.key}>
          <button type="button" className={pending.period === item.key ? "is-selected" : undefined} aria-pressed={pending.period === item.key}
            onClick={() => choosePreset(item.key)}>{item.label}</button>
        </li>)}</ul>
      </div>
      <div className="period-picker-body">
        <div className="period-picker-months">
          {months.map((monthStart, index) => <div className="period-picker-month" key={monthStart}>
            <div className="period-picker-month-head">
              {index === 0 ? <button type="button" aria-label="Mês anterior" onClick={() => setLeftMonth(addMonths(leftMonth, -1))}><ChevronLeft size={16} /></button> : <span />}
              <strong>{monthTitle(monthStart)}</strong>
              {index === 1 ? <button type="button" aria-label="Próximo mês" disabled={addMonths(monthStart, 1) > firstOfMonth(today) && monthStart >= firstOfMonth(today)}
                onClick={() => setLeftMonth(addMonths(leftMonth, 1))}><ChevronRight size={16} /></button> : <span />}
            </div>
            <table className="no-row-hover">
              <thead><tr>{WEEKDAYS.map(day => <th key={day} scope="col">{day}</th>)}</tr></thead>
              <tbody>{monthGrid(monthStart).map((week, row) => <tr key={row}>{week.map((day, column) => {
                if (!day) return <td key={column} />;
                const future = day > today;
                const edge = day === pending.from || day === pending.to;
                const inside = day > pending.from && day < pending.to;
                return <td key={column} className={[inside && "is-inside", day === pending.from && "is-start", day === pending.to && "is-end"].filter(Boolean).join(" ") || undefined}>
                  <button type="button" disabled={future} aria-label={rangeLabel(day, day)} aria-pressed={edge}
                    className={[edge && "is-edge", day === today && "is-today"].filter(Boolean).join(" ") || undefined}
                    onClick={() => chooseDay(day)}>{Number(day.slice(8))}</button>
                </td>;
              })}</tr>)}</tbody>
            </table>
          </div>)}
        </div>
        <div className="period-picker-footer">
          <span className={tooLong ? "is-error" : undefined} role={tooLong ? "alert" : undefined}>
            {tooLong ? `Escolha no máximo ${MAX_DAYS} dias.` : anchor ? "Escolha o último dia do período." : rangeLabel(pending.from, pending.to)}
          </span>
          <div>
            <button type="button" className="period-picker-cancel" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="button" className="period-picker-apply" disabled={tooLong || anchor !== null}
              onClick={() => { setOpen(false); onApply(pending); }}>Aplicar</button>
          </div>
        </div>
      </div>
    </div>}
  </div>;
}
