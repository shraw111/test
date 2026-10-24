// Runs inside the sandboxed preview iframe. Receives compiled bundles from the
// builder via postMessage, mounts them, and reports what happens back.
//
// parent -> iframe  { type: "load", buildId, js, css }
// iframe -> parent  { type: "ready" }
//                   { type: "rendered", buildId }
//                   { type: "runtime-error", buildId, phase, message, stack }
//                   { type: "console", buildId, level, text }
import React from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;
const parentOrigin = new URLSearchParams(location.search).get("parent");
const appCss = document.getElementById("app-css");

let root = null;
let currentBuild = null;
let lastUrl = null;
// Newest build requested so far. Imports can finish out of order (a module with
// top-level await, or just a bigger bundle), and an older build must never
// replace a newer one.
let newestRequested = 0;
const reported = new Set();

function send(message) {
  // The page is sandboxed with an opaque origin; targeting the builder's origin
  // keeps messages from leaking if the iframe is ever embedded elsewhere.
  window.parent.postMessage({ source: "ui-preview", ...message }, parentOrigin || "*");
}

function reportError(phase, error) {
  const message = error instanceof Error ? error.message : String(error);
  // React re-reports render errors through window.onerror in development.
  const key = `${currentBuild}:${message}`;
  if (reported.has(key)) return;
  reported.add(key);
  send({ type: "runtime-error", buildId: currentBuild, phase, message, stack: error?.stack ?? "" });
}

window.addEventListener("error", (e) => reportError("runtime", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => reportError("promise", e.reason));

function format(arg) {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

for (const level of ["log", "info", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    send({ type: "console", buildId: currentBuild, level, text: args.map(format).join(" ") });
  };
}

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    reportError("render", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return h(
      "pre",
      { style: { margin: 16, padding: 16, background: "#fff1f0", color: "#a8071a", whiteSpace: "pre-wrap", font: "13px ui-monospace, monospace" } },
      `Render error: ${this.state.error.message}`,
    );
  }
}

function Rendered({ buildId, children }) {
  React.useEffect(() => send({ type: "rendered", buildId }), [buildId]);
  return children;
}

async function load({ buildId, js, css }) {
  newestRequested = Math.max(newestRequested, buildId);
  // Set before import so top-level console output and errors of the new
  // module are attributed to this build.
  currentBuild = buildId;
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  let mod;
  try {
    mod = await import(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    // A superseded build's failure is irrelevant. Otherwise keep the last good
    // build on screen and just report why this one failed.
    if (buildId >= newestRequested) reportError("module", error);
    return;
  }
  if (buildId < newestRequested) {
    URL.revokeObjectURL(url);
    return;
  }
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = url;

  const App = mod.default;
  if (typeof App !== "function" && !(App && typeof App === "object" && App.$$typeof)) {
    reportError("module", new Error("The entry file must `export default` a React component."));
    return;
  }

  appCss.textContent = css ?? "";
  root ??= createRoot(document.getElementById("root"));
  root.render(h(ErrorBoundary, { key: buildId }, h(Rendered, { buildId }, h(App))));
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  if (parentOrigin && event.origin !== parentOrigin) return;
  if (event.data?.type === "load") load(event.data);
});

send({ type: "ready" });
