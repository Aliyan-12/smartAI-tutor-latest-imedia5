import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App";
import "./styles/index.css";
import { bootAccessibility } from "./lib/accessibility";

// Apply the viewer's saved accessibility settings before React mounts (no flash).
bootAccessibility();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
