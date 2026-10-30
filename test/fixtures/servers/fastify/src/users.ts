import type { FastifyInstance } from "fastify";
export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/:id", async () => ({}));
  fastify.post("/", async () => ({}));
}
