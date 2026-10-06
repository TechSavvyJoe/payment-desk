import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "./redesign.css";
import "./customer-print.css";

function Root() {
  // Remounting App on reset clears whatever deal state triggered the crash.
  const [appKey, setAppKey] = useState(0);
  return (
    <ErrorBoundary onReset={() => setAppKey((current) => current + 1)}>
      <App key={appKey} />
    </ErrorBoundary>
  );
}

// Compact phone layout follows the device screen, not the viewport: orientation-independent, and
// stable while the on-screen keyboard shrinks the viewport mid-typing. (CSP forbids inline scripts.)
// 800 takes in 360x780 and 360x800 Androids (Galaxy S22-S24, many Moto G), whose regular layout
// leaves Trade allowance under the bottom bar; 375x812 and taller phones fit without it.
if (Math.max(window.screen.width, window.screen.height) <= 800) document.documentElement.classList.add('compact-height');

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
