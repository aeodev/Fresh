import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

type Option = { value: string; label: ReactNode; disabled?: boolean };
/** Shared keyboard-accessible picker. Portals keep menus clear of cards and scrolling rails. */
export function Select({ value, onValueChange, children, disabled, className = "", style, label = "Select an option" }: {
  value: string; onValueChange: (value: string) => void; children: ReactNode; disabled?: boolean; className?: string; style?: CSSProperties; label?: string;
}) {
  const options = Children.toArray(children).filter(isValidElement).map(child => {
    const props = child.props as { value: string; children: ReactNode; disabled?: boolean };
    return { value: props.value, label: props.children, disabled: props.disabled } as Option;
  });
  const selected = options.findIndex(option => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const id = useId();
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const place = useCallback(() => {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const up = below < 180 && above > below;
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      setPosition({ position: "fixed", left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width, maxHeight: Math.min(320, Math.max(80, up ? above : below)), ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
  }, []);
  const show = () => { place(); setActive(Math.max(0, selected)); setOpen(true); };
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      place();
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>(`[data-index="${active}"]`)?.focus({ preventScroll: true });
  }, [open, active]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const move = (step: number) => {
    for (let i = 1; i <= options.length; i++) {
      const index = (active + step * i + options.length) % options.length;
      if (!options[index].disabled) { setActive(index); break; }
    }
  };
  return <div className={`custom-select ${className}`} style={style}>
    <button ref={trigger} type="button" className="select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={event => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); show(); }
    }}><span>{options[selected]?.label ?? label}</span><Icon name="chevronDown" size={16} /></button>
    {open && createPortal(<div ref={menu} id={id} className="select-menu" role="listbox" aria-label={label} style={position} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key === "Tab") close();
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
      else if (event.key === "Home" || event.key === "End") { event.preventDefault(); const indices = options.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0); setActive(event.key === "Home" ? indices[0] : indices.at(-1)!); }
      else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey) {
        search.current.text = Date.now() - search.current.at > 700 ? event.key : search.current.text + event.key;
        search.current.at = Date.now();
        const index = options.findIndex(o => !o.disabled && Children.toArray(o.label).join("").toLowerCase().startsWith(search.current.text.toLowerCase()));
        if (index >= 0) setActive(index);
      }
    }}>{options.map((option, index) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} data-index={index} tabIndex={index === active ? 0 : -1} onClick={() => { onValueChange(option.value); close(); }}><span>{option.label}</span><Icon name="check" size={16} /></button>)}</div>, document.body)}
  </div>;
}
