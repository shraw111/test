import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PreviewEngine, type Diagnostic, type Files } from "./engine";
import { ContentPanel } from "./ContentPanel";
import { aemApi } from "./content/aem-api";
import { ContentStore } from "./content/store";
import { generateContentTypes } from "./content/typegen";
import type { AemConfig } from "./content/types";
import { Editor } from "./Editor";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples";

const PREVIEW_URL = import.meta.env.VITE_PREVIEW_URL ?? "http://localhost:5181/";
const typeCheckMode = (() => {
  const value = new URLSearchParams(window.location.search).get("typeCheck");
  return value === "block" || value === "off" ? value : "report";
})();
const iframeSrc = `${PREVIEW_URL}?parent=${encodeURIComponent(window.location.origin)}`;

type Status =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "ok"; ms: number }
  | { kind: "compile-error"; ms: number }
  | { kind: "runtime-error" };

type Problem = Diagnostic & { origin: "compile" | "types" | "runtime" };
type ConsoleLine = { level: string; text: string };

export default function App() {
  const [example, setExample] = useState(DEFAULT_EXAMPLE);
  const [files, setFiles] = useState<Files>(EXAMPLES[DEFAULT_EXAMPLE]);
  const [active, setActive] = useState(Object.keys(EXAMPLES[DEFAULT_EXAMPLE])[0]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [buildProblems, setBuildProblems] = useState<Problem[]>([]);
  const [typeProblems, setTypeProblems] = useState<Problem[]>([]);
  const [runtimeProblems, setRuntimeProblems] = useState<Problem[]>([]);
  const [typeCheckState, setTypeCheckState] = useState<"checking" | "done" | "unavailable">("checking");
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [panel, setPanel] = useState<"problems" | "console" | "content">("problems");
  const [store] = useState(() => new ContentStore());
  const contentVersion = useSyncExternalStore(store.subscribe.bind(store), store.snapshot.bind(store));
  const [aemConfig, setAemConfig] = useState<AemConfig>();
  // Type declarations derived from the content; a change in shape triggers a re-check.
  const contentTypes = useMemo(() => generateContentTypes(store.all()), [store, contentVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const problems = useMemo(
    () => [...buildProblems, ...typeProblems, ...runtimeProblems],
    [buildProblems, typeProblems, runtimeProblems],
  );
  const typeErrorCount = typeProblems.filter((p) => p.severity === "error").length;

  useEffect(() => {
    const engine = new PreviewEngine(iframeRef.current!, { typeCheck: typeCheckMode, content: store });
    engineRef.current = engine;
    let currentBuild = 0;
    const unsubscribe = engine.subscribe((event) => {
      switch (event.type) {
        case "compiling":
          setStatus({ kind: "compiling" });
          setTypeCheckState("checking");
          break;
        case "typechecked":
          if (event.error) {
            setTypeCheckState("unavailable");
            console.error("Type-check unavailable:", event.error);
          } else {
            setTypeCheckState("done");
            setTypeProblems(event.diagnostics.map((d) => ({ ...d, origin: "types" })));
          }
          break;
        case "compiled":
          if (event.result.ok) {
            currentBuild = event.buildId;
            setStatus({ kind: "ok", ms: event.result.ms });
            setBuildProblems([]);
            setRuntimeProblems([]);
            setConsoleLines([]);
          } else {
            setStatus({ kind: "compile-error", ms: event.result.ms });
            setBuildProblems(event.result.errors.map((e) => ({ ...e, severity: "error", origin: "compile" })));
            setPanel("problems");
          }
          break;
        case "runtime-error":
          if (event.buildId !== currentBuild) break;
          setStatus({ kind: "runtime-error" });
          setRuntimeProblems((prev) => [...prev, { message: event.message, severity: "error", origin: "runtime" }]);
          setPanel("problems");
          break;
        case "console":
          if (event.buildId !== currentBuild) break;
          setConsoleLines((prev) => [...prev.slice(-199), { level: event.level, text: event.text }]);
          break;
      }
    });
    return () => {
      unsubscribe();
      engine.dispose();
    };
  }, [store]);

  useEffect(() => {
    void aemApi.config().then((config) => {
      setAemConfig(config);
      if (config.targetFolder) store.targetFolder = config.targetFolder;
    });
  }, [store]);

  // Rebuild shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => engineRef.current?.render(files), 250);
    return () => clearTimeout(timer);
  }, [files, contentTypes]);

  function loadExample(name: string) {
    setExample(name);
    setFiles(EXAMPLES[name]);
    setActive(Object.keys(EXAMPLES[name])[0]);
  }

  function addFile() {
    const name = window.prompt("File name (e.g. components/Header.tsx)")?.trim().replace(/^\/+/, "");
    if (!name || name in files) return;
    setFiles({ ...files, [name]: "" });
    setActive(name);
  }

  function removeFile(name: string) {
    const { [name]: _removed, ...rest } = files;
    setFiles(rest);
    if (active === name) setActive(Object.keys(rest)[0] ?? "");
  }

  function reloadPreview() {
    engineRef.current?.resetPreview();
    if (iframeRef.current) iframeRef.current.src = iframeSrc;
  }

  return (
    <div className="app">
      <header className="toolbar">
        <strong>UI Preview</strong>
        <select aria-label="Example" value={example} onChange={(e) => loadExample(e.target.value)}>
          {Object.keys(EXAMPLES).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <StatusPill status={status} typeErrors={typeErrorCount} typeCheck={typeCheckState} />
        <button className="ghost" onClick={reloadPreview}>
          Reload preview
        </button>
      </header>

      <section className="editor">
        <div className="tabs" role="tablist">
          {Object.keys(files).map((name) => (
            <div key={name} className={`tab ${name === active ? "active" : ""}`}>
              <button role="tab" aria-selected={name === active} onClick={() => setActive(name)}>
                {name}
              </button>
              <button className="close" aria-label={`Delete ${name}`} onClick={() => removeFile(name)}>
                ×
              </button>
            </div>
          ))}
          <button className="tab add" onClick={addFile} aria-label="Add file">
            +
          </button>
        </div>
        {active in files ? (
          <Editor
            filename={active}
            value={files[active]}
            diagnostics={problems.filter((p) => p.file === active)}
            onChange={(value) => setFiles((prev) => ({ ...prev, [active]: value }))}
          />
        ) : (
          <div className="empty">Add a file to start.</div>
        )}
      </section>

      <section className="preview">
        <iframe
          ref={iframeRef}
          title="Preview"
          src={iframeSrc}
          // No allow-same-origin: generated code gets an opaque origin and
          // cannot touch this app's cookies, storage or DOM.
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
        />
        <div className={`panel ${panel === "content" ? "panel-tall" : ""}`}>
          <div className="panel-tabs">
            <button className={panel === "problems" ? "active" : ""} onClick={() => setPanel("problems")}>
              Problems ({problems.length})
            </button>
            <button className={panel === "console" ? "active" : ""} onClick={() => setPanel("console")}>
              Console ({consoleLines.length})
            </button>
            <button className={panel === "content" ? "active" : ""} onClick={() => setPanel("content")}>
              Content ({store.all().length})
            </button>
          </div>
          <div className="panel-body" data-testid={`${panel}-panel`}>
            {panel === "problems" &&
              (problems.length === 0 ? (
                <div className="muted">No problems.</div>
              ) : (
                problems.map((p, i) => (
                  <div key={i} className={`line ${p.origin}`}>
                    <span className="tag">{p.origin}</span>
                    {p.file && (
                      <span className="loc">
                        {p.file}
                        {p.line != null && `:${p.line}:${(p.column ?? 0) + 1}`}
                      </span>
                    )}
                    {p.code != null && <span className="code">TS{p.code} </span>}
                    {p.message}
                  </div>
                ))
              ))}
            {panel === "content" && <ContentPanel store={store} config={aemConfig} version={contentVersion} />}
            {panel === "console" &&
              (consoleLines.length === 0 ? (
                <div className="muted">No console output.</div>
              ) : (
                consoleLines.map((c, i) => (
                  <div key={i} className={`line console-${c.level}`}>
                    <span className="tag">{c.level}</span>
                    {c.text}
                  </div>
                ))
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusPill({
  status,
  typeErrors,
  typeCheck,
}: {
  status: Status;
  typeErrors: number;
  typeCheck: "checking" | "done" | "unavailable";
}) {
  const suffix =
    typeCheck === "checking" ? " · checking types…" : typeErrors > 0 ? ` · ${typeErrors} type error${typeErrors > 1 ? "s" : ""}` : "";
  const text = {
    idle: "Starting…",
    compiling: "Compiling…",
    ok: status.kind === "ok" ? `Rendered · built in ${status.ms} ms${suffix}` : "",
    "compile-error": "Compile error",
    "runtime-error": "Runtime error",
  }[status.kind];
  const tone = status.kind === "ok" && typeErrors > 0 && typeCheck === "done" ? "status-warn" : `status-${status.kind}`;
  return (
    <span className={`status ${tone}`} role="status" data-testid="status">
      {text}
    </span>
  );
}
