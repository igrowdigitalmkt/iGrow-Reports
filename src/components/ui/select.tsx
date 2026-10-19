"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Option = { value: string; label: string; disabled: boolean };
type Group = { label: string | null; options: Option[] };

export type SelectChangeEvent = { target: { value: string; name: string }; currentTarget: { value: string; name: string } };

export type SelectProps = {
  /** Aceita os mesmos filhos do <select> nativo: <option> e <optgroup>. */
  children: ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: SelectChangeEvent) => void;
  name?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Texto mostrado quando nenhuma opção corresponde ao valor (ex.: listas que funcionam como menu de ação). */
  placeholder?: string;
  /** Conteúdo próprio do botão (ex.: um ícone). Sem ele, mostra o rótulo escolhido e a seta. */
  triggerContent?: ReactNode;
  /** Largura do conteúdo, em vez de ocupar a linha toda. Detectado pelas classes compact-select e w-auto. */
  inline?: boolean;
  /** Abre a lista alinhada à direita do botão. */
  alignEnd?: boolean;
};

export function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** Converte os <option>/<optgroup> recebidos em grupos simples (a ordem original é mantida). */
export function parseOptions(children: ReactNode): Group[] {
  const groups: Group[] = [];
  let loose: Group | null = null;
  const walk = (node: ReactNode, group: Group | null, groupDisabled: boolean) => {
    Children.forEach(node, child => {
      if (!isValidElement(child)) return;
      const element = child as ReactElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>;
      if (element.type === Fragment) { walk(element.props.children, group, groupDisabled); return; }
      if (element.type === "optgroup") {
        const next: Group = { label: element.props.label ?? "", options: [] };
        groups.push(next);
        loose = null;
        walk(element.props.children, next, groupDisabled || !!element.props.disabled);
        return;
      }
      if (element.type === "option") {
        const label = textOf(element.props.children);
        const option = { value: element.props.value != null ? String(element.props.value) : label, label, disabled: groupDisabled || !!element.props.disabled };
        let target = group;
        if (!target) {
          if (!loose) { loose = { label: null, options: [] }; groups.push(loose); }
          target = loose;
        }
        target.options.push(option);
      }
    });
  };
  walk(children, null, false);
  return groups;
}

/**
 * Lista suspensa no padrão visual da plataforma. Usa os mesmos filhos do <select> nativo e mantém um
 * <select> escondido, então formulários (name, required, FormData) e leitores de tela continuam funcionando.
 */
export function Select({
  children, value, defaultValue, onChange, name = "", id, required, disabled, className = "", title,
  placeholder, triggerContent, inline, alignEnd, ...aria
}: SelectProps) {
  const groups = useMemo(() => parseOptions(children), [children]);
  const flat = useMemo(() => groups.flatMap(group => group.options), [groups]);
  const fallback = flat.find(option => !option.disabled)?.value ?? "";
  const [inner, setInner] = useState(defaultValue != null ? String(defaultValue) : fallback);
  const current = value !== undefined ? String(value) : inner;
  const selected = flat.find(option => option.value === current);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<{ style: CSSProperties; inline: boolean }>({ style: {}, inline: false });
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;
  const isInline = inline ?? /(^|\s)!?(compact-select|w-auto)(\s|$)/.test(className);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popover.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const dismiss = (event: Event) => { if (!popover.current?.contains(event.target as Node)) setOpen(false); };
    // Barras de endereço de celulares disparam resize ao rolar: só fecha se a largura mudou de fato.
    const openedWidth = window.innerWidth;
    const resized = () => { if (window.innerWidth !== openedWidth) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", resized);
    popover.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", resized);
    };
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId depende só do id estável do componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function openList() {
    if (disabled) return;
    const rect = trigger.current?.getBoundingClientRect();
    // Dentro de diálogos (transform + rolagem) a lista abre colada ao botão; fora deles, solta no corpo da página.
    const inDialog = !!trigger.current?.closest('[role="dialog"]');
    if (rect && !inDialog) {
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 200 && above > below;
      const maxHeight = Math.max(120, Math.min(320, up ? above : below));
      const width = Math.max(rect.width, 200);
      const left = alignEnd ? Math.max(8, rect.right - width) : Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
      setPlacement({ inline: false, style: { position: "fixed", left, minWidth: width, maxHeight, ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) } });
    } else {
      setPlacement({ inline: true, style: alignEnd ? { right: 0, left: "auto" } : {} });
    }
    const selectedIndex = flat.findIndex(option => option.value === current && !option.disabled);
    setActive(selectedIndex >= 0 ? selectedIndex : flat.findIndex(option => !option.disabled));
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  function choose(index: number) {
    const option = flat[index];
    if (!option || option.disabled) return;
    if (value === undefined) setInner(option.value);
    onChange?.({ target: { value: option.value, name }, currentTarget: { value: option.value, name } });
    close();
  }

  function move(step: 1 | -1, from = active) {
    let index = from;
    for (let i = 0; i < flat.length; i += 1) {
      index = (index + step + flat.length) % flat.length;
      if (!flat[index].disabled) { setActive(index); return; }
    }
  }

  function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); openList(); }
  }

  function onListKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break;
      case "ArrowUp": event.preventDefault(); move(-1); break;
      case "Home": event.preventDefault(); setActive(flat.findIndex(option => !option.disabled)); break;
      case "End": event.preventDefault(); setActive(flat.map(option => option.disabled).lastIndexOf(false)); break;
      case "Enter": case " ": event.preventDefault(); choose(active); break;
      case "Escape": event.preventDefault(); event.stopPropagation(); close(); break;
      case "Tab": close(false); break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          const now = event.timeStamp;
          typed.current = { text: (now - typed.current.at > 600 ? "" : typed.current.text) + event.key.toLocaleLowerCase("pt-BR"), at: now };
          const start = typed.current.text.length > 1 ? active - 1 : active;
          for (let i = 1; i <= flat.length; i += 1) {
            const index = (start + i + flat.length) % flat.length;
            if (!flat[index].disabled && flat[index].label.toLocaleLowerCase("pt-BR").startsWith(typed.current.text)) { setActive(index); break; }
          }
        }
    }
  }

  const shown = selected && selected.value !== "" ? selected.label : (selected?.label || placeholder || "");
  const isPlaceholder = !selected || (selected.value === "" && selected.disabled) || (!selected.label && !!placeholder);
  const list = <div ref={popover} id={listId} role="listbox" tabIndex={-1} aria-label={aria["aria-label"]} aria-activedescendant={active >= 0 ? optionId(active) : undefined}
    className={`ui-select-popover${placement.inline ? " is-inline" : ""}`} style={placement.style} onKeyDown={onListKey}>
    {groups.map((group, groupIndex) => <div key={groupIndex} role={group.label ? "group" : "presentation"} aria-label={group.label || undefined}>
      {group.label && <div className="ui-select-group" aria-hidden="true">{group.label}</div>}
      {group.options.filter(option => !(option.value === "" && option.disabled)).map(option => {
        const position = flat.indexOf(option);
        const isSelected = option.value === current;
        return <div key={`${option.value}-${position}`} id={optionId(position)} role="option" aria-selected={isSelected} aria-disabled={option.disabled || undefined}
          className={`ui-select-option${position === active ? " is-active" : ""}${isSelected ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`}
          onMouseEnter={() => !option.disabled && setActive(position)} onMouseDown={event => event.preventDefault()} onClick={() => choose(position)}>
          <span>{option.label}</span>{isSelected && <Check size={15} aria-hidden="true" />}
        </div>;
      })}
    </div>)}
  </div>;

  return <span className={`ui-select${isInline ? " is-inline" : ""}`}>
    <button ref={trigger} type="button" id={id} title={title} disabled={disabled} className={`ui-select-trigger ${className}${isPlaceholder && !triggerContent ? " is-placeholder" : ""}`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={aria["aria-label"]} aria-labelledby={aria["aria-labelledby"]}
      onClick={() => (open ? close(false) : openList())} onKeyDown={onTriggerKey}>
      {triggerContent ?? <><span>{shown || " "}</span><ChevronDown size={16} aria-hidden="true" /></>}
    </button>
    <select className="ui-select-native" tabIndex={-1} aria-hidden="true" name={name || undefined} required={required} disabled={disabled}
      value={current} onChange={() => undefined}>{children}</select>
    {open && (placement.inline ? list : typeof document !== "undefined" ? createPortal(list, document.body) : null)}
  </span>;
}
