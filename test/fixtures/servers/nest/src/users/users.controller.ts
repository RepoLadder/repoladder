import { Controller, Get, Post, Param } from "@nestjs/common";

@Controller("users")
export class UsersController {
  @Get()
  findAll() { return []; }

  @Get(":id")
  findOne(@Param("id") id: string) { return id; }

  @Post([":id/ban", ":id/block"])
  ban() { return null; }

  helper() { return null; }
}

@Controller({ path: "health" })
export class HealthController {
  @Get("live")
  live() { return "ok"; }
}
