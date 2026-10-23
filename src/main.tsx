import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { bindAppState } from "./app/bindings";
import { boot } from "./app/boot";
import { installProductionGuards } from "./app/production-guards";
import { flushAll } from "./app/session";
import { bindThemeToDocument } from "./state/theme";
import "./styles/global.css";

bindThemeToDocument(document, window);
bindAppState(document);
if (import.meta.env.PROD) installProductionGuards(window);

// Pending settings are written when the window closes or is hidden (SPEC §9.4).
// flushAll never throws, so closing can't be blocked by a failed save.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flushAll();
});
if (isTauri()) {
  void getCurrentWindow().onCloseRequested(async () => {
    await flushAll();
  });
}

void boot();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element in index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
