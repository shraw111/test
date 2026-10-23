/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Preview origin, e.g. https://preview.example.com/ — must differ from the app's origin. */
  readonly VITE_PREVIEW_URL?: string;
}
