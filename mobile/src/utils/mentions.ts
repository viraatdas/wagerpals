// @mention token parsing + candidate matching for React Native text inputs.
//
// RN has no DOM caret API, so this tracks the in-progress '@' token from the
// controlled text value plus TextInput's onSelectionChange, instead of
// reading el.selectionStart the way the web implementation does. The rules
// themselves are kept identical on purpose:
//   - trigger regex mirrors MENTION_TOKEN_RE in
//     components/useMentionAutocomplete.tsx (web) — itself extracted from
//     the local getMentionCandidates()/token regex that used to live in
//     components/CommentForm.tsx.
//   - candidate ranking mirrors getMentionCandidates() in that same web
//     module (case-insensitive prefix match, de-duped by user_id,
//     alphabetical, capped at 6).
//
// Shared by CreateEventScreen.tsx and CreateEventFromInviteScreen.tsx so the
// title field's @mention behavior is identical on both screens.

export interface MentionMember {
  user_id: string;
  username: string;
  role?: string;
}

export interface MentionToken {
  query: string; // lowercase text typed after '@'
  start: number; // index of '@' within the full text
}

// Trailing "@token" ending exactly at the caret, preceded by start-of-string
// or a word-boundary character. Mirrors MENTION_TOKEN_RE in
// components/useMentionAutocomplete.tsx (web).
const MENTION_TOKEN_RE = /(?:^|[\s([{"',:;-])@([A-Za-z0-9_]{0,20})$/;

/**
 * Given the full text and the caret (selection start) position, returns the
 * in-progress mention token immediately before the caret, or null if the
 * caret isn't inside one. Callers get `caret` from TextInput's
 * onSelectionChange (only meaningful when selection.start === selection.end,
 * i.e. no range is selected).
 */
export function findMentionToken(text: string, caret: number): MentionToken | null {
  const before = text.slice(0, caret);
  const match = before.match(MENTION_TOKEN_RE);
  if (!match) return null;
  const query = match[1].toLowerCase();
  const start = caret - match[1].length - 1;
  return { query, start };
}

/**
 * Ranks group members against an in-progress '@' query. Mirrors
 * getMentionCandidates() in components/useMentionAutocomplete.tsx (web).
 */
export function getMentionCandidates(members: MentionMember[], query: string): MentionMember[] {
  const q = query.toLowerCase();
  const byId = new Map<string, MentionMember>();
  for (const member of members) {
    if (byId.has(member.user_id)) continue;
    if (member.username.toLowerCase().startsWith(q)) {
      byId.set(member.user_id, member);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, 6);
}

/**
 * Inserts "@username " in place of the in-progress token, returning the new
 * full text plus the caret position right after the inserted mention.
 */
export function acceptMentionToken(
  text: string,
  token: MentionToken,
  candidate: MentionMember
): { text: string; caret: number } {
  const tokenEnd = token.start + 1 + token.query.length;
  const before = text.slice(0, token.start);
  const after = text.slice(tokenEnd);
  const insertion = `@${candidate.username} `;
  return { text: `${before}${insertion}${after}`, caret: before.length + insertion.length };
}
