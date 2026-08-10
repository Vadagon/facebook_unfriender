import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.querySelector("#root");
if (!root) throw new Error("panel_root_missing");

createRoot(root).render(<App />);
