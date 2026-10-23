import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installProductionGuards } from "./app/production-guards";
import { bindThemeToDocument } from "./state/theme";
import "./styles/global.css";

bindThemeToDocument(document, window);
if (import.meta.env.PROD) installProductionGuards(window);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element in index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
