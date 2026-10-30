import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
const plugin: FastifyPluginAsync = async (app) => {
  app.route({ method: ["GET", "HEAD"], url: "/stats", handler: async () => ({}) });
};
export default fp(plugin);
