import express from "express";
export const app = express();
app.get("/users/:id", (_req, res) => { res.end(); });
