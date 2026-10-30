import { getUser } from "../../utils/users.server.ts";

export function loader({ params }: { params: { username: string } }) {
  return getUser(params.username);
}

export default function User() {
  return <form method="post" action="/logout" />;
}
