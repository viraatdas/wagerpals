// Overlapping circular avatars — the "people" primitive. Per the redesign's
// absolute colour rule (numbers -> emerald/crimson, people -> amber), this
// component never touches emerald or crimson: the ring and the initials
// fallback ground are always amber.
//
// No 'use client' needed: purely presentational, no state or effects.

export interface AvatarPerson {
  username: string;
  avatar_url?: string | null;
}

export type AvatarStackSize = 'sm' | 'md' | 'lg';

export interface AvatarStackProps {
  people: AvatarPerson[];
  /** Avatars shown before collapsing the rest into a "+N" chip. Defaults to 4. */
  max?: number;
  size?: AvatarStackSize;
  className?: string;
}

const SIZE_CLASSES: Record<AvatarStackSize, { box: string; text: string }> = {
  sm: { box: 'h-6 w-6', text: 'text-xs' },
  md: { box: 'h-8 w-8', text: 'text-sm' },
  lg: { box: 'h-10 w-10', text: 'text-base' },
};

// ~35% of each size's diameter (24/32/40px) — loose enough that two
// initials never collide, snug enough to still read as one cluster.
// Arbitrary-value classes rather than the space-* scale because the scale's
// steps (8/12/16px) don't land on 35% of every diameter.
const OVERLAP_CLASSES: Record<AvatarStackSize, string> = {
  sm: '-ml-[8px]',
  md: '-ml-[11px]',
  lg: '-ml-[14px]',
};

function initials(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return '?';
  // Single letter, not two — overlapping chips stacking two-letter initials
  // read as alphabet soup.
  return trimmed.charAt(0).toUpperCase();
}

/**
 * Builds the group's accessible label. Capped at `max` named people (mirrors
 * what is visually shown) plus a "and N more" tail so the label stays
 * readable for large groups instead of spelling out every username.
 */
function describePeople(people: AvatarPerson[], max: number): string {
  if (people.length === 0) return 'No one yet';

  const names = people.map((p) => p.username);
  if (names.length <= max) {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  const shown = names.slice(0, max).join(', ');
  const remaining = names.length - max;
  return `${shown}, and ${remaining} more`;
}

export default function AvatarStack({ people, max = 4, size = 'md', className }: AvatarStackProps) {
  const visible = people.slice(0, max);
  const overflowCount = people.length - visible.length;
  const sizeClasses = SIZE_CLASSES[size];
  const overlapClass = OVERLAP_CLASSES[size];
  const label = describePeople(people, max);
  // A single avatar (nothing overlapping it) keeps the amber identity ring.
  // Once a second circle (a real avatar, or the "+N" chip) sits behind it,
  // the ring switches to card-colored — a cutout separator between circles
  // instead of a second heavy amber ring mushing into the first. Amber
  // still carries "this is a person" via the initial's fill/tint; it's just
  // not doubled up as a border once circles start overlapping.
  const isStack = visible.length > 1 || overflowCount > 0;
  const ringClass = isStack ? 'border-2 border-card' : 'border-2 border-amber';

  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-center ${className ?? ''}`}
    >
      {visible.map((person, idx) => (
        <span
          key={`${person.username}-${idx}`}
          aria-hidden="true"
          title={person.username}
          style={{ zIndex: visible.length - idx }}
          className={`relative inline-flex items-center justify-center overflow-hidden rounded-pill bg-amber/15 font-sans font-semibold text-amber-ink ${ringClass} ${sizeClasses.box} ${sizeClasses.text} ${idx > 0 ? overlapClass : ''}`}
        >
          {person.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={person.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(person.username)
          )}
        </span>
      ))}
      {overflowCount > 0 && (
        // A count, not a person: quieter than the avatars it follows —
        // sunken fill, hairline border, mono ink-secondary text, never the
        // amber person-identity treatment.
        <span
          aria-hidden="true"
          style={{ zIndex: 0 }}
          className={`relative inline-flex items-center justify-center rounded-pill border border-hairline bg-surface-sunken font-mono font-semibold text-ink-secondary ${overlapClass} ${sizeClasses.box} ${sizeClasses.text}`}
        >
          +{overflowCount}
        </span>
      )}
    </div>
  );
}
