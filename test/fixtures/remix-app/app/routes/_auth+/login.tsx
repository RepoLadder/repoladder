import { getUser } from "../../utils/users.server.ts";

export async function action() {
  return getUser("me");
}

export default function Login() {
  return <form method="post" />;
}
