export type FragmentSource = "sample" | "aem" | "draft";

export interface Fragment {
  /** /content/dam/... path. For drafts, where it will be saved. */
  path: string;
  name: string;
  title: string;
  /** PascalCase model name, e.g. "HeroBanner". */
  model: string;
  /** Full /conf/... model path. Needed to save; absent for samples. */
  modelPath?: string;
  fields: Record<string, unknown>;
  source: FragmentSource;
}

/** What generated code receives from useFragment(). */
export type FragmentData = { _path: string; _title: string } & Record<string, unknown>;

export interface AemConfig {
  configured: boolean;
  flavor?: "cloud" | "65";
  host?: string;
  targetFolder?: string | null;
}
