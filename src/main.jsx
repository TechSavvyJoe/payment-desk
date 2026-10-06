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

// Compact phone layout, decided once from the height the browser actually leaves visible at load
// (after its address bar and toolbars). The regular layout needs about 804px to show Trade allowance
// above the bottom bar, so 800px or less goes compact: iPhones and most Androids inside a browser.
// It is never re-evaluated, so an on-screen keyboard or a collapsing toolbar cannot re-flow the page
// while someone types. The CSS only applies it at widths of 800px or less. (CSP forbids inline scripts.)
if (window.innerHeight <= 800) document.documentElement.classList.add('compact-height');

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
