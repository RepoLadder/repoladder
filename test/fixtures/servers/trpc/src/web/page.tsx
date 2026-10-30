import { trpc } from "./trpc";
export function Page() {
  const user = trpc.user.byId.useQuery("1");
  const create = trpc.user.create.useMutation();
  const missing = trpc.user.nope.useQuery();
  return <div>{String(user.data)}{String(create)}{String(missing)}</div>;
}
export const ping = () => trpc.health.ping.query();
