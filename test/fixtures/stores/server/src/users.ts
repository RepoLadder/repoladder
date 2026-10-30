import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function users() {
  await prisma.user.findMany({ where: { email: "a", OR: [{ name: "b" }] }, select: { id: true } });
  await prisma.post.create({ data: { title: "t" } });
  await prisma.$transaction([]);
}
