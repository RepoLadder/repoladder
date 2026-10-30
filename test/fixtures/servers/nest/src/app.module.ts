import { Module } from "@nestjs/common";
import { HealthController, UsersController } from "./users/users.controller";
@Module({ controllers: [UsersController, HealthController] })
export class AppModule {}
