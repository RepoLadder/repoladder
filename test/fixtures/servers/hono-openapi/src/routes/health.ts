import { createRoute } from "@hono/zod-openapi";
import { createRouter } from "../lib/create-app";
const ping = createRoute({ method: "get", path: "/ping", responses: {} });
const app = createRouter();
app.openapi(ping, (c) => c.text("pong"));
export default createRouter().openapi(createRoute({ method: "get", path: "/live", responses: {} }), (c) => c.text("ok"));
export { app as health };
