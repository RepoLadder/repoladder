import { Hono } from "hono";
import { books } from "./books";
const app = new Hono().basePath("/api");
app.get("/ping", (c) => c.text("pong"));
app.route("/books", books);
export default app;
