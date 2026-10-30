import { checkIn } from "../utils/kioskHttp";
import { NameScreen } from "../components/NameScreen";
import { Thanks } from "../components/Thanks";

export function KioskPage() {
  const done = (name: string) => checkIn(name);
  return [NameScreen(done), Thanks()];
}
