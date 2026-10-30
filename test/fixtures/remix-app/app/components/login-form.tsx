import { Form, Link, redirect } from "react-router";

export function LoginForm() {
  return (
    <div>
      <Form method="post" action="/login" />
      <Link to="/login">Log in</Link>
    </div>
  );
}

export const toLogin = () => redirect("/login");
