/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_BASE_PATH: string
  readonly VITE_SSE_DEBUG?: string
  readonly NODE_ENV: string
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}