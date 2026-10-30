import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../trpc";
export const userRouter = router({
  byId: publicProcedure.input(z.string()).query(({ input }) => input),
  create: protectedProcedure.input(z.object({ name: z.string() })).mutation(() => null),
});
