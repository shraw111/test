// @aem/content: what generated code imports to read content fragments.
// The preview iframe has no network access, so every call is a postMessage
// to the builder app, which owns the data (samples, fetched AEM fragments and
// local drafts) and the credentials. React stays external, like the DS.
import { useEffect, useState } from "react";

interface Pending {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

const pending = new Map<number, Pending>();
const changeListeners = new Set<() => void>();
const parentOrigin = new URLSearchParams(window.location.search).get("parent") ?? "*";
let nextId = 0;

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (message?.type === "content-response") {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) entry?.resolve(message.data);
    else entry?.reject(new Error(message.error));
  } else if (message?.type === "content-changed") {
    changeListeners.forEach((listener) => listener());
  }
});

function request(op: "get" | "list", args: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ source: "ui-preview", type: "content-request", id, op, args }, parentOrigin);
  });
}

interface State<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
}

function useContent<T>(op: "get" | "list", key: string, argName: string): State<T> {
  const [state, setState] = useState<State<T>>({ data: undefined, loading: true, error: undefined });
  const [version, setVersion] = useState(0);

  // Edits made in the builder (drafts, a newly loaded fragment) refresh live.
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    changeListeners.add(listener);
    return () => void changeListeners.delete(listener);
  }, []);

  useEffect(() => {
    let current = true;
    // Keep showing the previous data while refetching so the page doesn't flash.
    setState((s) => ({ ...s, loading: true }));
    request(op, { [argName]: key }).then(
      (data) => current && setState({ data: data as T, loading: false, error: undefined }),
      (error: Error) => current && setState({ data: undefined, loading: false, error: error.message }),
    );
    return () => {
      current = false;
    };
  }, [op, key, argName, version]);

  return state;
}

/** One fragment by its /content/dam path. */
export function useFragment<T = Record<string, unknown>>(path: string): State<T> {
  return useContent<T>("get", path, "path");
}

/** Every fragment of a model, e.g. useFragmentList("HeroBanner"). */
export function useFragmentList<T = Record<string, unknown>>(model: string): State<T[]> {
  return useContent<T[]>("list", model, "model");
}
