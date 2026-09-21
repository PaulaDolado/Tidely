import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { FontSizeProvider } from "./context/FontSizeContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <FontSizeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </FontSizeProvider>
    </ThemeProvider>
  </React.StrictMode>
);
