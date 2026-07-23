import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveClientSurface } from "./lib/routing";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App surface={resolveClientSurface(window.location.pathname)} />
  </React.StrictMode>,
);
