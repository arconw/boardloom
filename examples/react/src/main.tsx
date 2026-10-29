import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const target = document.getElementById("root");
if (target !== null) {
  createRoot(target).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
