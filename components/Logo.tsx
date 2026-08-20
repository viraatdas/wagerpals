'use client';

import { useId } from 'react';

export type LogoTone = 'color' | 'mono' | 'inverse';
export type LogoAnimate = 'none' | 'mount' | 'flip';

export interface LogoProps {
  /** 'mark' renders just the two-coin glyph; 'lockup' adds the "WagerPals" wordmark. */
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
 * The WagerPals mark: two sides of the same coin. One disc, cut by a diagonal
 * seam — the near half solid, the far half an open ring. It is the literal
 * phrase for a wager, and it echoes the tug-of-war bar that the bet detail page
 * is built around, so the logo and the product's core visual are the same idea.
 *
 * The seam is a real gap in the alpha channel rather than a colour change,
 * which is what lets this glyph survive being masked down to a single-colour
 * Android notification icon.
 *
 * There is deliberately no letter W here. The previous mark drew one out of two
 * chevrons; it was rejected, and no variant of this file may reintroduce it —
 * scripts/verify-brand.ts fails the build if a second <path> reappears.
 *
 * Geometry is locked and validated down to 16px — do not adjust coordinates,
 * radii, or the seam width. Ink spans 11..53 on both axes (a disc of r=21 about
 * the centre), so the glyph is already centred in the 64-unit viewBox.
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
  const ringGradientId = `logo-ring-${uid}`;
  const seamMaskId = `logo-seam-${uid}`;

  const accessibleTitle = title ?? DEFAULT_TITLE;

  // One stroke for both coins, per tone. The mark is monochrome by design: the
  // brand's single accent is the whole point, so there is no second colour to
  // keep in sync with the palette.
  // One colour for the whole glyph, per tone. The mark is monochrome by design:
  // the brand's single accent is the point, so there is no second colour to keep
  // in sync with the palette.
  const ink =
    tone === 'mono' ? 'currentColor' : tone === 'inverse' ? '#ffffff' : `url(#${ringGradientId})`;

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
        {/* Ring gradient is only referenced in tone="color" (inverse/mono are solid) */}
        {tone === 'color' && (
          <linearGradient id={ringGradientId} x1="11" y1="11" x2="53" y2="53" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--brand-1, #6EF9A5)" />
            <stop offset="1" stopColor="var(--brand-3, #0F9E56)" />
          </linearGradient>
        )}
        {/* The seam. Cuts a 4.6-unit channel straight down the middle of the
            rotated group, separating the solid half from the open ring. */}
        <mask id={seamMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect x="0" y="0" width="64" height="64" fill="#fff" />
          <rect x="29.7" y="2" width="4.6" height="60" fill="#000" />
        </mask>
      </defs>
      {animate !== 'none' && (
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .logo-coin-l-${uid},
            .logo-coin-r-${uid} {
              transform-box: fill-box;
              transform-origin: center;
            }

            ${
              animate === 'mount'
                ? `
            /* the two halves close on the seam */
            @keyframes logo-mount-l-${uid} {
              from { opacity: 0; transform: translateX(-7px); }
              to   { opacity: 1; transform: translateX(0); }
            }
            @keyframes logo-mount-r-${uid} {
              from { opacity: 0; transform: translateX(7px); }
              to   { opacity: 1; transform: translateX(0); }
            }
            .logo-coin-l-${uid} {
              animation: logo-mount-l-${uid} 460ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
            }
            .logo-coin-r-${uid} {
              animation: logo-mount-r-${uid} 460ms 60ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
            }
            `
                : `
            /* the coin flips on its axis, the far half trailing */
            @keyframes logo-flip-coin-${uid} {
              0%   { transform: scaleX(1); }
              25%  { transform: scaleX(0.06); }
              50%  { transform: scaleX(1); }
              75%  { transform: scaleX(0.06); }
              100% { transform: scaleX(1); }
            }
            .logo-coin-r-${uid} {
              animation: logo-flip-coin-${uid} 700ms var(--ease-in-out, cubic-bezier(0.65, 0, 0.35, 1)) backwards;
            }
            .logo-coin-l-${uid} {
              animation: logo-flip-coin-${uid} 700ms 90ms var(--ease-in-out, cubic-bezier(0.65, 0, 0.35, 1)) backwards;
            }
            `
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .logo-coin-l-${uid},
            .logo-coin-r-${uid} {
              animation: none;
            }
          }
        `}</style>
      )}
      <g key={animKey} transform="rotate(-20 32 32)">
        <g mask={`url(#${seamMaskId})`}>
          {/* the open half — drawn first so the solid half sits over its edge */}
          <circle
            className={`logo-coin-r-${uid}`}
            cx="32"
            cy="32"
            r="17.5"
            fill="none"
            stroke={ink}
            strokeWidth="7"
          />
          {/* the solid half */}
          <path className={`logo-coin-l-${uid}`} d="M32,11 A21,21 0 0,0 32,53 Z" fill={ink} />
        </g>
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
