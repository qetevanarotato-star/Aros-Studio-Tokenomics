'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Marks html for Framer embed + phone readability CSS.
 * ?embed=1 hides chrome (header/footer).
 * ?mobile=1 or narrow viewport → denser type/spacing.
 */
export function EmbedShell() {
  const search = useSearchParams();
  const embed = search.get('embed') === '1';
  const mobileParam = search.get('mobile') === '1';

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const applyMobile = () => {
      const narrow = window.matchMedia('(max-width: 720px)').matches;
      const mobile = mobileParam || narrow;
      root.classList.toggle('is-embed', embed);
      root.classList.toggle('is-mobile-embed', embed && mobile);
      body.classList.toggle('is-embed', embed);
      body.classList.toggle('is-mobile-embed', embed && mobile);
    };
    applyMobile();
    const mq = window.matchMedia('(max-width: 720px)');
    mq.addEventListener('change', applyMobile);
    return () => {
      mq.removeEventListener('change', applyMobile);
      root.classList.remove('is-embed', 'is-mobile-embed');
      body.classList.remove('is-embed', 'is-mobile-embed');
    };
  }, [embed, mobileParam]);

  return null;
}
