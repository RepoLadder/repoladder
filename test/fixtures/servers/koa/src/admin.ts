import Router from "@koa/router";
const admin = new Router();
admin.get("user", "/users/:id", (ctx) => { ctx.body = {}; });
export default admin;
