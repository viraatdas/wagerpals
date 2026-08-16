'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

type Phase = 'idle' | 'loading' | 'done';

export default function NavigationProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>('idle');
  const timersRef = useRef<number[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!link) return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      clearTimers();
      setPhase('loading');
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  useEffect(() => {
    clearTimers();
    // Route settled: snap the bar the rest of the way to full, hold briefly,
    // then reset — reads as "arrived", not just "timed out".
    setPhase('loading');
    timersRef.current = [
      window.setTimeout(() => setPhase('done'), 160),
      window.setTimeout(() => setPhase('idle'), 480),
    ];

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-0.5 overflow-hidden" aria-hidden="true">
      <div
        className={`h-full origin-left bg-brand-gradient transition-transform ease-out-expo ${
          phase === 'loading'
            ? 'scale-x-[0.7] duration-slower'
            : phase === 'done'
            ? 'scale-x-100 duration-fast'
            : 'scale-x-0 duration-instant'
        }`}
      />
    </div>
  );
}
