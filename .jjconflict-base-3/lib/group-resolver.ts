import { db } from './db';

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
