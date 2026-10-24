import { SAMPLE_FRAGMENTS } from "./samples";
import { blankLike } from "./typegen";
import type { Fragment, FragmentData } from "./types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

/**
 * The content the preview can read: samples, fragments fetched from AEM and
 * local drafts. Lives in the builder app; the preview only sees it through
 * the @aem/content bridge.
 */
export class ContentStore {
  private fragments = new Map<string, Fragment>();
  private listeners = new Set<() => void>();
  private version = 0;
  /** Where drafts will be saved. Set from the server's config. */
  targetFolder = "/content/dam/drafts";

  constructor(seed: Fragment[] = SAMPLE_FRAGMENTS) {
    for (const f of seed) this.fragments.set(f.path, f);
  }

  all(): Fragment[] {
    return [...this.fragments.values()];
  }

  get(path: string): Fragment | undefined {
    return this.fragments.get(path);
  }

  models(): string[] {
    return [...new Set(this.all().map((f) => f.model))];
  }

  /** Bumps on any change, so the UI can re-render. */
  snapshot(): number {
    return this.version;
  }

  put(fragment: Fragment) {
    this.fragments.set(fragment.path, fragment);
    this.changed();
  }

  remove(path: string) {
    if (this.fragments.delete(path)) this.changed();
  }

  /** Moves a fragment to a new path, optionally patching it (used after a save). */
  rename(from: string, to: string, patch: Partial<Fragment> = {}) {
    const existing = this.fragments.get(from);
    if (!existing) return;
    this.fragments.delete(from);
    this.fragments.set(to, { ...existing, ...patch, path: to });
    this.changed();
  }

  /** New draft with the same field shape as an existing fragment of that model. */
  createDraft(model: string, title: string): Fragment {
    // Prefer a fragment that came from AEM: it carries the real model path the draft needs to be saved.
    const sameModel = this.all().filter((f) => f.model === model);
    const template = sameModel.find((f) => f.modelPath) ?? sameModel[0];
    if (!template) throw new Error(`Unknown model "${model}"`);
    const name = slug(title);
    if (!name) throw new Error("Enter a title.");
    const path = `${this.targetFolder}/${name}`;
    if (this.fragments.has(path)) throw new Error(`${path} already exists.`);
    const draft: Fragment = {
      path,
      name,
      title,
      model,
      modelPath: template.modelPath,
      fields: blankLike(template.fields) as Record<string, unknown>,
      source: "draft",
    };
    this.put(draft);
    return draft;
  }

  /** Editable copy of any fragment. */
  duplicateAsDraft(path: string): Fragment {
    const source = this.fragments.get(path);
    if (!source) throw new Error(`No fragment at ${path}`);
    let title = `${source.title} copy`;
    let n = 2;
    while (this.fragments.has(`${this.targetFolder}/${slug(title)}`)) title = `${source.title} copy ${n++}`;
    const name = slug(title);
    const draft: Fragment = { ...structuredClone(source), path: `${this.targetFolder}/${name}`, name, title, source: "draft" };
    this.put(draft);
    return draft;
  }

  /** What generated code receives for a fragment. */
  data(path: string): FragmentData {
    const f = this.fragments.get(path);
    if (!f) {
      const known = this.all().map((x) => x.path).join(", ") || "none";
      throw new Error(`No content fragment at ${path}. Available: ${known}`);
    }
    return { _path: f.path, _title: f.title, ...f.fields };
  }

  list(model: string): FragmentData[] {
    return this.all().filter((f) => f.model === model).map((f) => this.data(f.path));
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private changed() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}
