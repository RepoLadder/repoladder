import { prisma } from "./db.server.ts";

export function getUser(username: string) {
  return prisma.user.findUnique({ where: { username } });
}
