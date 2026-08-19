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
  const label = describePeople(people, max);

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
          className={`relative inline-flex items-center justify-center overflow-hidden rounded-pill border-2 border-amber bg-amber/15 font-sans font-semibold text-amber-ink ${sizeClasses.box} ${sizeClasses.text} ${idx > 0 ? '-ml-2' : ''}`}
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
        <span
          aria-hidden="true"
          style={{ zIndex: 0 }}
          className={`relative -ml-2 inline-flex items-center justify-center rounded-pill border-2 border-amber bg-amber/15 font-sans font-semibold text-amber-ink ${sizeClasses.box} ${sizeClasses.text}`}
        >
          +{overflowCount}
        </span>
      )}
    </div>
  );
}
