'use client';

import { useId } from 'react';

export type LogoTone = 'color' | 'mono' | 'inverse';
export type LogoAnimate = 'none' | 'mount' | 'flip';

export interface LogoProps {
  /** 'mark' renders just the W+coin glyph; 'lockup' adds the "WagerPals" wordmark. */
  variant?: 'mark' | 'lockup';
  /** Color treatment of the mark. */
  tone?: LogoTone;
  /** Entrance animation to play. */
  animate?: LogoAnimate;
  /** Change this value to restart the animation (remounts the animated group). */
  replayKey?: string | number;
  /** Pixel size — sets the svg's width/height attributes. */
  size?: number;
  /** Applied to the <svg> for 'mark'; applied to the wrapping element for 'lockup' (use `markClassName` to reach the svg in that case). */
  className?: string;
  /** Lockup only — applied directly to the inner <svg> mark (e.g. sizing, hover transforms), independent of the wrapper's `className`. */
  markClassName?: string;
  /** Lockup only — overrides the wordmark's classes (e.g. size). */
  wordmarkClassName?: string;
  /** Accessible name. Ignored when `decorative` is true. */
  title?: string;
  /** When true, the mark is aria-hidden and gets no <title>. */
  decorative?: boolean;
}

const DEFAULT_TITLE = 'WagerPals';

/**
 * The WagerPals mark: two mirrored chevrons meeting at a raised centre apex
 * (the two sides of a bet meeting in the middle), crowned by a gold coin
 * (the stake). Geometry is locked — do not adjust coordinates, stroke
 * widths, or radii; it has been validated down to 16px.
 */
export function LogoMark({
  tone = 'color',
  animate = 'none',
  replayKey,
  size = 32,
  className,
  title,
  decorative = false,
}: Omit<LogoProps, 'variant' | 'markClassName' | 'wordmarkClassName'>) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '');

  const titleId = `logo-title-${uid}`;
  const wGradientId = `logo-w-${uid}`;
  const coinGradientId = `logo-c-${uid}`;

  const accessibleTitle = title ?? DEFAULT_TITLE;

  // Stroke/fill for the two chevrons and the coin, per tone.
  const leftChevronStroke = tone === 'mono' ? 'currentColor' : tone === 'inverse' ? '#ffffff' : `url(#${wGradientId})`;
  const rightChevronStroke = leftChevronStroke;
  // #f59e0b has no design-system token (only --neon-amber / #d97706 is tokenized) —
  // kept as a literal here for the gradient's lighter stop.
  const coinFill = tone === 'mono' ? 'currentColor' : `url(#${coinGradientId})`;

  const animateSuffix = String(replayKey ?? '');
  const animKey = `${animate}-${animateSuffix}`;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={decorative ? undefined : 'img'}
      aria-labelledby={decorative ? undefined : titleId}
      aria-hidden={decorative ? 'true' : undefined}
      focusable={decorative ? 'false' : undefined}
    >
      {!decorative && <title id={titleId}>{accessibleTitle}</title>}
      {tone !== 'mono' && (
        <defs>
          {/* W gradient is only referenced in tone="color" (inverse uses solid #fff) */}
          {tone === 'color' && (
            <linearGradient id={wGradientId} x1="6" y1="12" x2="58" y2="12" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--brand-1, #3b82f6)" />
              <stop offset="1" stopColor="var(--brand-3, #1d4ed8)" />
            </linearGradient>
          )}
          {/* Coin stays gold in both color and inverse tones */}
          <linearGradient id={coinGradientId} x1="26" y1="10" x2="38" y2="22" gradientUnits="userSpaceOnUse">
            {/* #f59e0b has no design-system token (only --neon-amber / #d97706 is tokenized) — kept as a literal */}
            <stop offset="0" stopColor="#f59e0b" />
            <stop offset="1" stopColor="var(--neon-amber, #d97706)" />
          </linearGradient>
        </defs>
      )}
      {animate !== 'none' && (
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .logo-chevron-l-${uid},
            .logo-chevron-r-${uid},
            .logo-coin-${uid} {
              transform-box: fill-box;
              transform-origin: center;
            }

            ${
              animate === 'mount'
                ? `
            @keyframes logo-mount-l-${uid} {
              from { opacity: 0; transform: translateX(-6px); }
              to   { opacity: 1; transform: translateX(0); }
            }
            @keyframes logo-mount-r-${uid} {
              from { opacity: 0; transform: translateX(6px); }
              to   { opacity: 1; transform: translateX(0); }
            }
            @keyframes logo-mount-coin-${uid} {
              0%   { opacity: 0; transform: translateY(-10px) scale(0.6); }
              60%  { opacity: 1; transform: translateY(1px) scale(1.08); }
              80%  { transform: translateY(-0.5px) scale(0.97); }
              100% { opacity: 1; transform: translateY(0) scale(1); }
            }
            .logo-chevron-l-${uid} {
              animation: logo-mount-l-${uid} 420ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
            }
            .logo-chevron-r-${uid} {
              animation: logo-mount-r-${uid} 420ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
            }
            .logo-coin-${uid} {
              animation: logo-mount-coin-${uid} 480ms 160ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) backwards;
            }
            `
                : `
            @keyframes logo-flip-coin-${uid} {
              0%   { transform: scaleX(1); }
              25%  { transform: scaleX(0); }
              50%  { transform: scaleX(1); }
              75%  { transform: scaleX(0); }
              100% { transform: scaleX(1); }
            }
            @keyframes logo-flip-settle-${uid} {
              0%   { transform: translateY(0); }
              50%  { transform: translateY(-0.5px); }
              100% { transform: translateY(0); }
            }
            .logo-coin-${uid} {
              animation: logo-flip-coin-${uid} 700ms var(--ease-in-out, cubic-bezier(0.65, 0, 0.35, 1)) backwards;
            }
            .logo-chevron-l-${uid},
            .logo-chevron-r-${uid} {
              animation: logo-flip-settle-${uid} 700ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
            }
            `
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .logo-chevron-l-${uid},
            .logo-chevron-r-${uid},
            .logo-coin-${uid} {
              animation: none;
            }
          }
        `}</style>
      )}
      <g key={animKey} transform="translate(0,-1.5)">
        <path
          className={`logo-chevron-l-${uid}`}
          d="M6,13 L18,52 L32,21"
          fill="none"
          stroke={leftChevronStroke}
          strokeWidth="8.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className={`logo-chevron-r-${uid}`}
          d="M32,21 L46,52 L58,13"
          fill="none"
          stroke={rightChevronStroke}
          strokeWidth="8.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className={`logo-coin-${uid}`} cx="32" cy="15" r="5.9" fill={coinFill} />
      </g>
    </svg>
  );
}

/** The mark plus the "WagerPals" wordmark, rendered as real DOM text (loaded webfont). */
export function LogoLockup({
  tone = 'color',
  animate = 'none',
  replayKey,
  size = 32,
  className,
  markClassName,
  wordmarkClassName,
  title,
  decorative = false,
}: Omit<LogoProps, 'variant'>) {
  const wordmarkColorClass =
    tone === 'inverse' ? 'text-white' : 'text-foreground';
  const palsColorClass = tone === 'inverse' ? 'text-white' : 'text-brand-2';
  // wordmarkClassName overrides only the size classes (default: text-lg sm:text-2xl);
  // truncation, the display font, weight, and tone-driven color always apply.
  const sizeClasses = wordmarkClassName ?? 'text-lg sm:text-2xl';

  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className ?? ''}`}>
      <LogoMark
        tone={tone}
        animate={animate}
        replayKey={replayKey}
        size={size}
        className={markClassName}
        title={title}
        decorative={decorative}
      />
      <span className={`truncate font-display font-semibold ${wordmarkColorClass} ${sizeClasses}`}>
        Wager<span className={palsColorClass}>Pals</span>
      </span>
    </span>
  );
}

/** WagerPals logo — the mark alone, or the mark + wordmark lockup. */
export default function Logo({ variant = 'mark', ...props }: LogoProps) {
  if (variant === 'lockup') {
    return <LogoLockup {...props} />;
  }
  return <LogoMark {...props} />;
}
