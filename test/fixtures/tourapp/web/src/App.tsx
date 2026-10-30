import { BrowserRouter, Route, Routes } from "react-router-dom";
import { KioskPage } from "./kiosk/KioskPage";
import { AdminPage } from "./admin/AdminPage";
import { BillingPage } from "./billing/BillingPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/kiosk" element={<KioskPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/billing" element={<BillingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
