import { Hono } from "hono";
export const books = new Hono();
books.get("/", (c) => c.json([])).post("/:id/borrow", (c) => c.json({}));
