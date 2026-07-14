import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

export type SupabaseRuntimeConfig = {
  url: string;
  restUrl: string;
  publishableKey: string;
  legacyAnonKey: string;
  secretKey: string;
  databaseUrl: string;
  credentialEncryptionKey: string;
  frontendReady: boolean;
  privilegedReady: boolean;
  encryptionReady: boolean;
};

export function readSupabaseConfig(): SupabaseRuntimeConfig {
  const url = readEnv("SUPABASE_URL");
  const publishableKey = readEnv("SUPABASE_PUBLISHABLE_KEY") || readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  const legacyAnonKey = readEnv("SUPABASE_ANON_KEY");
  const secretKey = readEnv("SUPABASE_SECRET_KEY");
  const databaseUrl = readEnv("SUPABASE_DATABASE_URL");
  const credentialEncryptionKey = readEnv("SKP_CREDENTIAL_ENCRYPTION_KEY");

  return {
    url,
    restUrl: readEnv("SUPABASE_REST_URL") || (url ? `${url.replace(/\/+$/, "")}/rest/v1/` : ""),
    publishableKey,
    legacyAnonKey,
    secretKey,
    databaseUrl,
    credentialEncryptionKey,
    frontendReady: Boolean(url && publishableKey),
    privilegedReady: Boolean(url && (secretKey || databaseUrl)),
    encryptionReady: credentialEncryptionKey.length >= 32
  };
}

export function createPublicSupabaseClient() {
  const config = readSupabaseConfig();
  if (!config.frontendReady) return null;
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket
    }
  });
}

export function createPrivilegedSupabaseClient() {
  const config = readSupabaseConfig();
  if (!config.url || !config.secretKey) return null;
  return createClient(config.url, config.secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket
    }
  });
}

export async function checkSupabaseConnection(): Promise<Record<string, unknown>> {
  const config = readSupabaseConfig();
  const client = createPublicSupabaseClient();
  if (!client) {
    return {
      ok: false,
      frontendReady: false,
      privilegedReady: config.privilegedReady,
      message: "Konfigurasi Supabase frontend belum lengkap."
    };
  }

  const startedAt = Date.now();
  const { error } = await client.from("profiles").select("id", { count: "exact", head: true });
  return {
    ok: !error,
    frontendReady: config.frontendReady,
    privilegedReady: config.privilegedReady,
    encryptionReady: config.encryptionReady,
    latencyMs: Date.now() - startedAt,
    message: error ? normalizeSupabaseStatusMessage(error.message) : "Koneksi Supabase berhasil."
  };
}

function normalizeSupabaseStatusMessage(message: string): string {
  if (/relation .* does not exist/i.test(message)) {
    return "Supabase terhubung, tetapi migration schema belum diterapkan.";
  }
  return message;
}

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}
