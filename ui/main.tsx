import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { i18nReady } from "./i18n.ts";
import "./styles.css";

async function bootstrap(): Promise<void> {
  await i18nReady;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
