import { useEffect, useState } from "react";
import { aemApi } from "./content/aem-api";
import type { ContentStore } from "./content/store";
import type { AemConfig, Fragment } from "./content/types";

interface Props {
  store: ContentStore;
  config: AemConfig | undefined;
  /** Re-renders when the store changes. */
  version: number;
}

type Message = { kind: "info" | "error"; text: string } | undefined;

export function ContentPanel({ store, config, version }: Props) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [selected, setSelected] = useState<string>();
  const [newModel, setNewModel] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [fieldsText, setFieldsText] = useState("");
  const [fieldsError, setFieldsError] = useState<string>();

  const fragments = store.all();
  const models = store.models();
  const current = selected ? store.get(selected) : undefined;
  const editable = current?.source === "draft";

  useEffect(() => {
    if (!newModel && models[0]) setNewModel(models[0]);
  }, [models, newModel, version]);

  // Load the selected fragment's fields into the editor when the selection changes.
  useEffect(() => {
    const f = selected ? store.get(selected) : undefined;
    setFieldsText(f ? JSON.stringify(f.fields, null, 2) : "");
    setFieldsError(undefined);
  }, [selected, store]);

  async function load() {
    if (!link.trim()) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const fragment = await aemApi.resolve(link.trim());
      store.put(fragment);
      setSelected(fragment.path);
      setLink("");
      setMessage({ kind: "info", text: `Loaded ${fragment.path} (model ${fragment.model}).` });
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function run(action: () => Fragment | void) {
    try {
      const result = action();
      if (result) setSelected(result.path);
      setMessage(undefined);
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
    }
  }

  function editFields(text: string) {
    setFieldsText(text);
    if (!current || !editable) return;
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Fields must be a JSON object.");
      store.put({ ...current, fields: parsed });
      setFieldsError(undefined);
    } catch (error) {
      setFieldsError((error as Error).message);
    }
  }

  async function save(fragment: Fragment) {
    const where = config?.host ? `${config.host} (${config.flavor === "cloud" ? "Cloud Service" : "6.5"})` : "AEM";
    const ok = window.confirm(
      `Create this content fragment in ${where}?\n\n${fragment.path}\nModel: ${fragment.model}\nTitle: ${fragment.title}\n\nIt will be created as an unpublished fragment. Existing fragments are never overwritten.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const saved = await aemApi.create(fragment);
      store.rename(fragment.path, saved.path, { source: "aem" });
      setSelected(saved.path);
      setMessage({ kind: "info", text: `Saved to AEM: ${saved.path}` });
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const canSave = !!config?.configured && !!config.targetFolder && !!current?.modelPath && editable;
  const saveHint = !config?.configured
    ? "AEM is not configured on the server."
    : !config.targetFolder
      ? "No target folder is configured."
      : !current?.modelPath
        ? "Sample models can't be saved. Load a fragment of the model you want from AEM first."
        : "";

  return (
    <div className="content">
      <div className="content-status muted" data-testid="aem-status">
        {config?.configured
          ? `Connected to ${config.host} (${config.flavor === "cloud" ? "Cloud Service" : "6.5"})${config.targetFolder ? ` · new fragments save to ${config.targetFolder}` : " · read-only (no target folder)"}`
          : "AEM is not configured: sample content only."}
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          aria-label="AEM link"
          placeholder="Paste a link to a content fragment…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          disabled={!config?.configured}
        />
        <button disabled={busy || !link.trim() || !config?.configured}>Load</button>
      </form>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => store.createDraft(newModel, newTitle.trim()));
          setNewTitle("");
        }}
      >
        <select aria-label="Model" value={newModel} onChange={(e) => setNewModel(e.target.value)}>
          {models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input aria-label="New fragment title" placeholder="New fragment title…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <button disabled={!newTitle.trim() || !newModel}>New draft</button>
      </form>

      {message && (
        <div className={`notice notice-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </div>
      )}

      <div className="fragments" role="list">
        {fragments.map((f) => (
          <div key={f.path} role="listitem" className={`fragment ${f.path === selected ? "active" : ""}`}>
            <button className="fragment-main" onClick={() => setSelected(f.path)}>
              <span className={`badge badge-${f.source}`}>{f.source}</span>
              <span className="fragment-title">{f.title}</span>
              <span className="muted">{f.model}</span>
              <span className="muted path">{f.path}</span>
            </button>
            <button className="ghost" onClick={() => run(() => store.duplicateAsDraft(f.path))}>
              Duplicate as draft
            </button>
            {f.source === "draft" && (
              <button className="ghost" aria-label={`Discard ${f.title}`} onClick={() => store.remove(f.path)}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {current && (
        <div className="editor-pane">
          <div className="row">
            <strong>{current.title}</strong>
            <span className="muted path">{current.path}</span>
            {editable && (
              <button disabled={!canSave || busy || !!fieldsError} title={saveHint} onClick={() => void save(current)}>
                Save to AEM
              </button>
            )}
          </div>
          {!editable && <div className="muted">Read-only. Duplicate it as a draft to edit.</div>}
          {editable && !canSave && <div className="muted">{saveHint}</div>}
          <textarea
            aria-label="Fragment fields"
            spellCheck={false}
            readOnly={!editable}
            value={fieldsText}
            onChange={(e) => editFields(e.target.value)}
          />
          {fieldsError && <div className="notice notice-error">{fieldsError}</div>}
        </div>
      )}
    </div>
  );
}
