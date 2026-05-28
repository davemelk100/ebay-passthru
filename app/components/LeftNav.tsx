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
    const sections = ITEMS.map((it) => document.getElementById(it.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting section so the highlight follows the
        // section the user is actually reading, not whichever entry fired last.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );
    for (const s of sections) observer.observe(s);
    return () => observer.disconnect();
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
