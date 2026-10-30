import express from "express";
const users = express.Router();
users.get("/", (_req, res) => res.end());
users.get("/:id", (_req, res) => res.end());
users.route("/:id/avatar").put((_req, res) => res.end()).delete((_req, res) => res.end());
export default users;
