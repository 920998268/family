/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UNI_CLOUD_SPACE_ID?: string;
  readonly VITE_UNI_CLOUD_SPACE_APP_ID?: string;
  readonly VITE_UNI_CLOUD_ACCESS_KEY?: string;
  readonly VITE_UNI_CLOUD_SECRET_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
