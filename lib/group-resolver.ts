import { db } from './db';

// DEPRECATED for authorization as of R2 ("only the event's creator resolves
// it"). This used to decide who could resolve/unresolve/cancel/delete an
// event and who was shown as a group's "resolver" — that job now belongs to
// event.created_by (fallback: group.created_by for legacy rows with NULL),
// checked directly in app/api/events/resolve/route.ts,
// app/api/events/unresolve/route.ts, app/api/events/delete/route.ts, and
// exposed on event payloads by app/api/events/route.ts. None of those files
// call this function anymore, and no other caller was found in the
// codebase at the time of that change. Left in place (unused) rather than
// deleted, per this task's instructions, in case a future display feature
// still wants the old "who resolves this group by default" computation —
// remove it once nothing references this comment either.
export async function getGroupResolver(groupId: string) {
  const group = await db.groups.get(groupId);
  if (!group) return null;

  const members = await db.groupMembers.getByGroup(groupId);
  const activeMembers = members.filter((member) => member.status === 'active');
  const selectedResolver = group.resolver_user_id
    ? activeMembers.find((member) => member.user_id === group.resolver_user_id)
    : null;

  return (
    selectedResolver ||
    activeMembers.find((member) => member.user_id === group.created_by) ||
    activeMembers.find((member) => member.role === 'admin') ||
    activeMembers[0] ||
    null
  );
}
