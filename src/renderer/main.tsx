import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { storeTema } from "./estado/tema";
import { marcar } from "./perf";
import "./fontes.css";
import "./tokens.css";

storeTema.iniciar();
createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
requestAnimationFrame(() => requestAnimationFrame(() => marcar("renderer:primeira-pintura")));
