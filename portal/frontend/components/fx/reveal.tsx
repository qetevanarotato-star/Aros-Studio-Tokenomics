'use client';

import { useEffect } from 'react';

/** Observes `.reveal` nodes and adds `.reveal-in` when they enter the viewport. */
export function RevealRoot() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('reveal-in'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('reveal-in');
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );

    const scan = () => {
      document.querySelectorAll('.reveal:not(.reveal-bound)').forEach((el) => {
        el.classList.add('reveal-bound');
        io.observe(el);
      });
    };

    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return null;
}
