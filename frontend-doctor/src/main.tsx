import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AuthProvider } from "./context/AuthContext";
import { LiveUpdatesProvider } from "./context/LiveUpdatesContext";
import { ToastProvider } from "./components/ui/Toast";
import { InstallPrompt } from "./components/InstallPrompt";
import App from "./App";
import "./index.css";
import { LanguageRoot } from "./i18n/LanguageRoot";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageRoot>{() => (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <LiveUpdatesProvider>
            <App />
            <InstallPrompt />
            </LiveUpdatesProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
    )}</LanguageRoot>
  </React.StrictMode>
);
