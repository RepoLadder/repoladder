import express from "express";
import api from "./routes/index";
const app = express();
app.use(express.json());
app.use("/api", api);
app.use("/health", require("./health"));
app.get("/", (_req, res) => res.end());
app.listen(3000);
