import Fastify from "fastify";
import userRoutes from "./users";
const fastify = Fastify();
fastify.register(userRoutes, { prefix: "/users" });
fastify.register(import("./admin.js"), { prefix: "/admin" });
fastify.register(async (v2) => { v2.get("/ping", async () => "pong"); }, { prefix: "/v2" });
fastify.route({ method: "GET", url: "/status", handler: async () => "ok" });
