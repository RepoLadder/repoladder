import { createRoot } from "react-dom/client";
import { fetchUser } from "@/lib";
import "./styles.css";
const Home = () => import("./pages/Home");
createRoot(document.body).render(null);
fetchUser();
export { Home };
