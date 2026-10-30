import prisma from "@/lib/prisma";

export async function getWebsites() {
  return prisma.client.website.findMany({ where: { name: "a" } });
}

export async function createSession() {
  return prisma.client.session.create({ data: { websiteId: "w" } });
}
