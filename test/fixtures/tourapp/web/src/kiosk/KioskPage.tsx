import { checkInPatient } from "./kioskHttp";
import { Button } from "../ui/Button";
export function KioskPage() { return <Button label={String(checkInPatient)} />; }
