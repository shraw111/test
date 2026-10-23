import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Diagnostic } from "./engine";

function language(filename: string) {
  if (filename.endsWith(".css")) return css();
  return javascript({ jsx: true, typescript: /\.tsx?$/.test(filename) });
}

function toCm(doc: EditorState["doc"], diagnostics: Diagnostic[]): CmDiagnostic[] {
  return diagnostics.flatMap((d) => {
    if (d.line == null || d.line < 1 || d.line > doc.lines) return [];
    const line = doc.line(d.line);
    const from = Math.min(line.from + (d.column ?? 0), line.to);
    // Underline the identifier at the error position, or at least one character.
    const word = /^[\w$]+/.exec(doc.sliceString(from, line.to));
    const to = Math.min(from + Math.max(word?.[0].length ?? 1, 1), line.to);
    return [{ from, to: Math.max(to, from), severity: d.severity ?? "error", message: d.message, source: d.source }];
  });
}

interface Props {
  /** Changing the filename remounts the editor with that file's language. */
  filename: string;
  value: string;
  diagnostics: Diagnostic[];
  onChange: (value: string) => void;
}

export function Editor({ filename, value, diagnostics, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Read through refs so the update listener and a freshly mounted editor see the latest props.
  const latestDiagnostics = useRef(diagnostics);
  const latestOnChange = useRef(onChange);
  latestDiagnostics.current = diagnostics;
  latestOnChange.current = onChange;

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          lintGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          language(filename),
          oneDark,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ "aria-label": "Code editor", spellcheck: "false" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latestOnChange.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    editor.dispatch(setDiagnostics(editor.state, toCm(editor.state.doc, latestDiagnostics.current)));
    return () => {
      editor.destroy();
      view.current = null;
    };
    // value is intentionally excluded: it only seeds the document on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  // External document changes (loading an example, a model rewriting the file).
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  // Diagnostics come from outside (compiler, type-checker, preview), not from a
  // linter run, so push them into the editor directly.
  useEffect(() => {
    const editor = view.current;
    if (editor) editor.dispatch(setDiagnostics(editor.state, toCm(editor.state.doc, diagnostics)));
  }, [diagnostics, value]);

  return <div className="cm-host" ref={host} />;
}
