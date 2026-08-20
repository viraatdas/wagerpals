'use client';

import { useId } from 'react';

export type LogoTone = 'color' | 'mono' | 'inverse';
export type LogoAnimate = 'none' | 'mount' | 'flip';

export interface LogoProps {
  /** 'mark' renders just the emerald square + W glyph; 'lockup' adds the "WagerPals" wordmark. */
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
 * The WagerPals mark: the app icon rebuilt for inline use — a rounded
 * emerald square with a chunky paper-white "W" stroked across it, and the
 * same W drawn stroke-only (no square) for `tone="mono"` contexts. This
 * replaces the earlier "split coin" mark (a circle cut by a seam) that this
 * file drew for a while; that mark and the in-app icon had drifted apart,
 * which is the whole reason this component now matches the icon exactly.
 *
 * tone="color": emerald-gradient square, paper-white W (the default — same
 * as the installed app icon).
 * tone="mono": no square, just the W stroke in `currentColor`, for contexts
 * that supply their own background (e.g. sitting inside an already-colored
 * button or badge).
 * tone="inverse": a paper-white square with an emerald W — the inverse of
 * "color" rather than a plain white silhouette, chosen deliberately: an
 * emerald square on top of an already-dark/emerald hero background reads as
 * a hole, not a mark, whereas a paper-white tile keeps the icon's silhouette
 * legible against any dark backdrop.
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
  const squareGradientId = `logo-square-${uid}`;

  const accessibleTitle = title ?? DEFAULT_TITLE;

  const showSquare = tone !== 'mono';
  const squareFill =
    tone === 'color' ? `url(#${squareGradientId})` : 'var(--color-paper, #FAF7F0)';
  const strokeColor =
    tone === 'mono' ? 'currentColor' : tone === 'inverse' ? 'var(--color-emerald, #0F7A4C)' : 'var(--color-paper, #FAF7F0)';

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
      <defs>
        {/* Gradient is only referenced by tone="color" (mono/inverse are solid). */}
        {tone === 'color' && (
          <linearGradient id={squareGradientId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--brand-1, #3FA073)" />
            <stop offset="1" stopColor="var(--brand-3, #0C5F3B)" />
          </linearGradient>
        )}
      </defs>
      {animate !== 'none' && (
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .logo-square-${uid},
            .logo-w-${uid} {
              transform-box: fill-box;
              transform-origin: center;
            }

            ${
              animate === 'mount'
                ? `
            /* the tile fades and settles in first, the W follows a beat behind */
            @keyframes logo-mount-square-${uid} {
              from { opacity: 0; transform: scale(0.85); }
              to   { opacity: 1; transform: scale(1); }
            }
            @keyframes logo-mount-w-${uid} {
              from { opacity: 0; transform: translateY(4px) scale(0.9); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            .logo-square-${uid} {
              animation: logo-mount-square-${uid} 380ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
            }
            .logo-w-${uid} {
              animation: logo-mount-w-${uid} 420ms 90ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
            }
            `
                : `
            /* the whole mark gives a quick confident flip on its vertical axis */
            @keyframes logo-flip-${uid} {
              0%   { transform: scaleX(1); }
              25%  { transform: scaleX(0.08); }
              50%  { transform: scaleX(1); }
              75%  { transform: scaleX(0.08); }
              100% { transform: scaleX(1); }
            }
            .logo-square-${uid},
            .logo-w-${uid} {
              animation: logo-flip-${uid} 700ms var(--ease-in-out, cubic-bezier(0.65, 0, 0.35, 1)) backwards;
            }
            `
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .logo-square-${uid},
            .logo-w-${uid} {
              animation: none;
            }
          }
        `}</style>
      )}
      <g key={animKey}>
        {showSquare && (
          <rect
            className={`logo-square-${uid}`}
            x="0"
            y="0"
            width="64"
            height="64"
            rx="14"
            ry="14"
            fill={squareFill}
          />
        )}
        {/*
          The W — a single 5-point polyline (top-left, bottom-left valley,
          centre peak, bottom-right valley, top-right), thick round-capped
          stroke. The points/strokeWidth/strokeLinecap/strokeLinejoin values
          below must stay byte-identical to the matching <polyline> in every
          scripts/brand/*.svg source file (they're written as literal
          attribute values, not a shared constant, so scripts/verify-brand.ts
          can read both as plain text and catch drift). Font-free on purpose:
          a <text> glyph (even with the Archivo Black webfont loaded) won't
          render in a bare SVG context like a favicon or a notification-icon
          silhouette, so the letterform is drawn as geometry instead.
        */}
        <polyline
          className={`logo-w-${uid}`}
          points="14,18 23,47 32,29 41,47 50,18"
          fill="none"
          stroke={strokeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
