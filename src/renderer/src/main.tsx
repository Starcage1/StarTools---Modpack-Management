import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

// Use the bundled editor API so the config editor works without a CDN/network.
loader.config({ monaco });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
