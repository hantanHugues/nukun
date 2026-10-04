// Nùkún website: a line under the menu once the page scrolls, the titles that
// translate themselves (once, when they come into view), the help page's contents.
(() => {
  const nav = document.querySelector(".nav");
  const onScroll = () => nav && nav.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Every language: each title is scanned, then shown translated, one after the other.
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const list = document.querySelector(".babel");
  if (list && !still && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        [...list.children].forEach((li, i) => {
          setTimeout(() => li.classList.add("scan"), 500 + i * 650);
          setTimeout(() => li.classList.add("done"), 950 + i * 650);
        });
      },
      { threshold: 0.45 },
    );
    io.observe(list);
  }

  // Help page: the section being read is lit in the contents.
  const links = [...document.querySelectorAll(".help-nav a")];
  if (links.length && "IntersectionObserver" in window) {
    const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          links.forEach((a) => a.classList.remove("active"));
          byId.get(e.target.id)?.classList.add("active");
        }
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    document.querySelectorAll(".help-body section[id]").forEach((s) => seen.observe(s));
  }
})();
