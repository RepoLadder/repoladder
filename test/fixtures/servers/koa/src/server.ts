import Koa from "koa";
import Router from "@koa/router";
import admin from "./admin";
const app = new Koa();
const router = new Router({ prefix: "/v1" });
router.get("/status", (ctx) => { ctx.body = "ok"; });
router.use("/admin", admin.routes(), admin.allowedMethods());
app.use(router.routes());
