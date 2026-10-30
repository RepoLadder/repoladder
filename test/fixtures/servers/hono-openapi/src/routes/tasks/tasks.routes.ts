import { createRoute } from "@hono/zod-openapi";
export const list = createRoute({ path: "/tasks", method: "get", responses: {} });
export const create = createRoute({
  method: "post",
  path: "/tasks",
  responses: {},
});
export const getOne = createRoute({ path: "/tasks/{id}", method: "get", responses: {} });
const internal = createRoute({ path: "/internal", method: "get", responses: {} });
export { internal as hidden };
