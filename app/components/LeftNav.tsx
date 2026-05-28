"use client";

import { useEffect, useState } from "react";

interface NavItem {
  id: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { id: "inventory", label: "Listings & bids" },
  { id: "counter-bid", label: "Counter-bid" },
];

export default function LeftNav() {
  const [activeId, setActiveId] = useState<string>(ITEMS[0].id);

  useEffect(() => {
    // Active = the section whose top has scrolled to or past LINE, but whose
    // successor has not. With collapsed <details> panels (Active Offers,
    // Trading API, Sell REST, Shopify sync) clustered tightly against
    // expanded ones, any "max-below-threshold" approach skips the short
    // sections because the next section also qualifies. Range containment
    // gives exactly one winner per scroll position.
    const LINE = 24; // matches scroll-mt-6 — the offset anchor-jumps land at.
    function pickActive() {
      let best = ITEMS[0].id;
      for (let i = 0; i < ITEMS.length; i++) {
        const el = document.getElementById(ITEMS[i].id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top > LINE) break;
        const nextEl =
          i + 1 < ITEMS.length ? document.getElementById(ITEMS[i + 1].id) : null;
        const nextTop = nextEl
          ? nextEl.getBoundingClientRect().top
          : Number.POSITIVE_INFINITY;
        if (nextTop > LINE) {
          best = ITEMS[i].id;
          break;
        }
      }
      // Pin the last item when scrolled to (near) the bottom: with nothing
      // below it, the last section's top may never reach LINE, so range
      // containment leaves the previous section perpetually active.
      const docH = document.documentElement.scrollHeight;
      const nearBottom = window.scrollY + window.innerHeight >= docH - 40;
      if (nearBottom) best = ITEMS[ITEMS.length - 1].id;
      setActiveId(best);
    }
    pickActive();
    window.addEventListener("scroll", pickActive, { passive: true });
    window.addEventListener("resize", pickActive);
    return () => {
      window.removeEventListener("scroll", pickActive);
      window.removeEventListener("resize", pickActive);
    };
  }, []);

  return (
    <nav className="fixed left-4 top-36 hidden lg:block" aria-label="Page sections">
      <ul className="space-y-1 text-sm">
        {ITEMS.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              className={`block rounded-md px-3 py-1.5 transition-colors ${
                activeId === it.id
                  ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
