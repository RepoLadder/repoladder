import { loadForms } from "./adminApi";
import { Button } from "../ui/Button";
export function AdminPage() { return <Button label={String(loadForms)} />; }
