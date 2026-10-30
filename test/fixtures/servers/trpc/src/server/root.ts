import { router, publicProcedure } from "./trpc";
import { userRouter } from "./routers/user";
export const appRouter = router({
  user: userRouter,
  health: router({
    ping: publicProcedure.query(() => "pong"),
  }),
});
export type AppRouter = typeof appRouter;
