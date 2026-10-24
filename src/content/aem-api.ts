import type { AemConfig, Fragment } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const aemApi = {
  config: () => call<AemConfig>("/api/aem/config").catch((): AemConfig => ({ configured: false })),

  async resolve(link: string): Promise<Fragment> {
    const { fragment } = await call<{ fragment: Omit<Fragment, "source"> }>("/api/aem/resolve", {
      method: "POST",
      body: JSON.stringify({ link }),
    });
    return { ...fragment, source: "aem" };
  },

  create: (fragment: Fragment) =>
    call<{ path: string; url: string }>("/api/aem/create", {
      method: "POST",
      body: JSON.stringify({ name: fragment.name, title: fragment.title, modelPath: fragment.modelPath, fields: fragment.fields }),
    }),
};
