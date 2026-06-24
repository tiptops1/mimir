import "server-only";
import { controlPrisma } from "@/lib/control-db";

/**
 * Resolve activity-author display names from the CONTROL plane.
 *
 * `Activity.userId` is a loose id into the control-plane `User` (auth lives
 * there, not in the tenant DB), so author names are fetched here in one batch
 * and mapped by id.
 */
export async function authorNamesByUserId(
  userIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const users = await controlPrisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name ?? ""]));
}
