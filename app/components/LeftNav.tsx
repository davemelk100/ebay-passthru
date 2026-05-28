"use client";

import { useEffect, useState } from "react";

interface NavItem {
  id: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { id: "inventory", label: "Inventory" },
  { id: "offers", label: "Active offers" },
  { id: "trading", label: "Trading API" },
  { id: "counter-bid", label: "Counter-bid" },
  { id: "sell-rest", label: "Sell REST" },
  { id: "about", label: "What this app does" },
  { id: "shopify", label: "Shopify sync" },
];

export default function LeftNav() {
  const [activeId, setActiveId] = useState<string>(ITEMS[0].id);

  useEffect(() => {
    // Active = the last section whose top has scrolled above THRESHOLD px from
    // the viewport top. Monotonic with scroll position, so short sections
    // (like the About block sitting between Sell REST and Shopify sync) get
    // a proper active window instead of being skipped by intersection math.
    const THRESHOLD = 120;
    function pickActive() {
      let best = ITEMS[0].id;
      for (const it of ITEMS) {
        const el = document.getElementById(it.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - THRESHOLD <= 0) best = it.id;
        else break;
      }
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
    <nav className="sticky top-6 hidden lg:block" aria-label="Page sections">
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
