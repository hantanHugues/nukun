import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type SelectOption<T extends string | number> = { value: T; label: string };

/**
 * A drop-down list drawn by the app, in its colours. The system's own list (a native
 * <select>) ignores the theme and looks different on every operating system.
 * Keyboard: arrows, Home/End, Enter or Space to choose, Escape to close.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  fit,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  /** Read by screen readers when the visible label is not next to the list. */
  label?: string;
  /** As wide as its text instead of the whole line. */
  fit?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // The chosen line stays in view when the list opens or the keyboard moves.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (i: number) => {
    setOpen(false);
    if (options[i] && options[i].value !== value) onChange(options[i].value);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.min(options.length - 1, Math.max(0, i)));
    };
    if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(options.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      // Closes the list only, not the page behind it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className={`dropdown${fit ? " fit" : ""}${open ? " open" : ""}`} ref={root}>
      <button
        type="button"
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span>{current?.label}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <ul className="dropdown-list" role="listbox" id={id} ref={list} aria-label={label}>
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? "active" : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
