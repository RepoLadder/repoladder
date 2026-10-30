import { prisma } from "../../utils/db.server.ts";

export async function loader() {
  return new Response(String(await prisma.user.count()));
}
