import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PreviewEngine, type Diagnostic, type Files } from "./engine";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples";

const PREVIEW_URL = import.meta.env.VITE_PREVIEW_URL ?? "http://localhost:5181/";
const iframeSrc = `${PREVIEW_URL}?parent=${encodeURIComponent(window.location.origin)}`;

type Status =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "ok"; ms: number }
  | { kind: "compile-error"; ms: number }
  | { kind: "runtime-error" };

type Problem = Diagnostic & { source: "compile" | "runtime" };
type ConsoleLine = { level: string; text: string };

export default function App() {
  const [example, setExample] = useState(DEFAULT_EXAMPLE);
  const [files, setFiles] = useState<Files>(EXAMPLES[DEFAULT_EXAMPLE]);
  const [active, setActive] = useState(Object.keys(EXAMPLES[DEFAULT_EXAMPLE])[0]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [panel, setPanel] = useState<"problems" | "console">("problems");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);

  useEffect(() => {
    const engine = new PreviewEngine(iframeRef.current!);
    engineRef.current = engine;
    let currentBuild = 0;
    const unsubscribe = engine.subscribe((event) => {
      switch (event.type) {
        case "compiling":
          setStatus({ kind: "compiling" });
          break;
        case "compiled":
          if (event.result.ok) {
            currentBuild = event.buildId;
            setStatus({ kind: "ok", ms: event.result.ms });
            setProblems([]);
            setConsoleLines([]);
          } else {
            setStatus({ kind: "compile-error", ms: event.result.ms });
            setProblems(event.result.errors.map((e) => ({ ...e, source: "compile" })));
            setPanel("problems");
          }
          break;
        case "runtime-error":
          if (event.buildId !== currentBuild) break;
          setStatus({ kind: "runtime-error" });
          setProblems((prev) => [...prev, { message: event.message, source: "runtime" }]);
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
  }, []);

  // Rebuild shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => engineRef.current?.render(files), 250);
    return () => clearTimeout(timer);
  }, [files]);

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

  function onEditorKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const next = el.value.slice(0, start) + "  " + el.value.slice(end);
    setFiles({ ...files, [active]: next });
    requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
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
        <StatusPill status={status} />
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
          <textarea
            aria-label="Code editor"
            wrap="off"
            spellCheck={false}
            value={files[active]}
            onChange={(e) => setFiles({ ...files, [active]: e.target.value })}
            onKeyDown={onEditorKeyDown}
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
        <div className="panel">
          <div className="panel-tabs">
            <button className={panel === "problems" ? "active" : ""} onClick={() => setPanel("problems")}>
              Problems ({problems.length})
            </button>
            <button className={panel === "console" ? "active" : ""} onClick={() => setPanel("console")}>
              Console ({consoleLines.length})
            </button>
          </div>
          <div className="panel-body" data-testid={`${panel}-panel`}>
            {panel === "problems" &&
              (problems.length === 0 ? (
                <div className="muted">No problems.</div>
              ) : (
                problems.map((p, i) => (
                  <div key={i} className={`line ${p.source}`}>
                    <span className="tag">{p.source}</span>
                    {p.file && (
                      <span className="loc">
                        {p.file}
                        {p.line != null && `:${p.line}:${(p.column ?? 0) + 1}`}
                      </span>
                    )}
                    {p.message}
                  </div>
                ))
              ))}
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

function StatusPill({ status }: { status: Status }) {
  const text = {
    idle: "Starting…",
    compiling: "Compiling…",
    ok: status.kind === "ok" ? `Rendered · built in ${status.ms} ms` : "",
    "compile-error": "Compile error",
    "runtime-error": "Runtime error",
  }[status.kind];
  return (
    <span className={`status status-${status.kind}`} role="status" data-testid="status">
      {text}
    </span>
  );
}
