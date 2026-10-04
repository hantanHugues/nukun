import { useEffect, useState } from "react";

/**
 * Table of contents of a long page, in the style of the portfolio's About page:
 * a dash and a title per section; the section on screen is highlighted.
 */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const main = document.getElementById("main-scroll");
    if (!main) return;
    const onScroll = () => {
      const top = main.getBoundingClientRect().top + 140;
      let current = items[0]?.id;
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (el && el.getBoundingClientRect().top <= top) current = it.id;
      }
      // At the very bottom, the last section is the one being read.
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) current = items[items.length - 1]?.id;
      setActive(current);
    };
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [items]);

  const go = (id: string) => {
    const main = document.getElementById("main-scroll");
    const el = document.getElementById(id);
    if (!main || !el) return;
    const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 24;
    main.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <nav className="section-nav" aria-label="Sections de la page">
      {items.map((it) => (
        <button
          key={it.id}
          className={`section-nav-item ${active === it.id ? "active" : ""}`}
          aria-current={active === it.id ? "true" : undefined}
          onClick={() => go(it.id)}
        >
          <span className="dash" />
          {it.label}
        </button>
      ))}
    </nav>
  );
}
