import React from "react";
import { createRoot } from "react-dom/client";
import { ChatApp } from "./ChatApp";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <ChatApp />
    </React.StrictMode>
  );
}
