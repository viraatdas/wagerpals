// Renders a wager TITLE with @mentions picked out in Amber — the "people"
// accent (DESIGN-SPEC.md's color rule: numbers are emerald/crimson, people
// are amber). This is the single place that splits a title on @handles for
// display; every title render site should use this instead of a per-site
// regex. Titles inside editable INPUTS stay plain strings — this is a
// read-only render helper, never used to build/parse mention syntax (see
// lib/comments.ts for that).
const MENTION_PATTERN = /@[a-zA-Z0-9_]+/g;

export interface TitleTextProps {
  title: string;
  className?: string;
}

export default function TitleText({ title, className }: TitleTextProps) {
  const parts = title.split(MENTION_PATTERN);
  const mentions = title.match(MENTION_PATTERN) ?? [];

  return (
    <span className={className}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < mentions.length && (
            <span className="font-medium text-amber-ink">{mentions[i]}</span>
          )}
        </span>
      ))}
    </span>
  );
}
