/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_DOCTOR_SITE_URL?: string;
  readonly VITE_NATIVE_PUSH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
