import { createRoute } from "@hono/zod-openapi";
import { createRouter } from "../lib/create-app";
const list = createRoute({ method: "get", path: "/notes", responses: {} });
export const notes = createRouter().openapi(list, (c) => c.json([]));
