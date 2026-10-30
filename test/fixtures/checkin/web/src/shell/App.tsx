import { KioskPage } from "../pages/KioskPage";
import { QrPage } from "../pages/QrPage";
import { initials } from "../utils/format";

export const routes = { "/kiosk": KioskPage, "/qr": QrPage, badge: initials };
