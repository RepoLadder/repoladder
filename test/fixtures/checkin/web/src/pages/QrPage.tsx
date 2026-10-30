import { checkIn } from "../utils/kioskHttp";
import { NameScreen } from "../components/NameScreen";

export const QrPage = () => NameScreen((name: string) => checkIn(name));
