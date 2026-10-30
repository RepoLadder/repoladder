import { pay } from "./billingApi";
import { Button } from "../ui/Button";
export function BillingPage() { return <Button label={String(pay)} />; }
