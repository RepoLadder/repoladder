import { Outlet } from "@remix-run/react";

export async function loader() {
  return null;
}

export default function Notes() {
  return <Outlet />;
}
