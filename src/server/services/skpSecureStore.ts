import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "../../main/supabase/config";

const ENCRYPTION_VERSION = "v1";

type CredentialInput = {
  username: string;
  password: string;
};

type SessionInput = {
  status?: string;
  storageState?: string | null;
  cookies?: string | null;
  displayName?: string | null;
  expiresAt?: string | null;
  message?: string | null;
};

export type DecryptedSkpCredentials = {
  username: string | null;
  password: string | null;
};

export type PublicSkpAuthStatus = {
  status: "connected" | "not_logged_in" | "expired" | "checking" | "error";
  isLoggedIn: boolean;
  username: null;
  displayName: string | null;
  lastCheckedAt: string;
  message: string;
  configured: boolean;
  credentialConfigured: boolean;
};

export function encryptSecret(value: string): string {
  const key = credentialKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [ENCRYPTION_VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== ENCRYPTION_VERSION || !iv || !tag || !encrypted) return null;
  const decipher = createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

export function isEncryptedEnvelope(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(":");
  return parts.length === 4 && parts[0] === ENCRYPTION_VERSION && parts.slice(1).every((part) => part.length > 0);
}

export async function getCredentialStatus(supabase: SupabaseClient, userId: string): Promise<{ configured: boolean; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("skp_credentials")
    .select("encrypted_username,encrypted_password,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    configured: Boolean(data?.encrypted_username && data?.encrypted_password),
    updatedAt: data?.updated_at ?? null
  };
}

export async function saveCredentials(supabase: SupabaseClient, userId: string, input: CredentialInput): Promise<{ configured: true; updatedAt: string }> {
  const username = input.username.trim();
  const password = input.password;
  if (!username || !password) throw new Error("Username dan password SKP wajib diisi.");
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("skp_credentials")
    .upsert(
      {
        user_id: userId,
        encrypted_username: encryptSecret(username),
        encrypted_password: encryptSecret(password),
        encryption_version: ENCRYPTION_VERSION,
        last_rotated_at: now,
        updated_at: now
      },
      { onConflict: "user_id" }
    )
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { configured: true, updatedAt: data.updated_at ?? now };
}

export async function deleteCredentials(supabase: SupabaseClient, userId: string): Promise<{ configured: false }> {
  const { error } = await supabase.from("skp_credentials").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { configured: false };
}

export async function readCredentialsForBackend(supabase: SupabaseClient, userId: string): Promise<DecryptedSkpCredentials> {
  const { data, error } = await supabase
    .from("skp_credentials")
    .select("encrypted_username,encrypted_password")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    username: decryptSecret(data?.encrypted_username),
    password: decryptSecret(data?.encrypted_password)
  };
}

export async function saveSkpSession(supabase: SupabaseClient, userId: string, input: SessionInput): Promise<{ status: string }> {
  const now = new Date().toISOString();
  const status = input.status ?? "unknown";
  const row: Record<string, unknown> = {
    user_id: userId,
    status,
    display_name: input.displayName ?? null,
    last_checked_at: now,
    expires_at: input.expiresAt ?? null,
    message: input.message ?? null,
    updated_at: now
  };
  if (input.storageState !== undefined) row.encrypted_storage_state = input.storageState ? encryptSecret(input.storageState) : null;
  if (input.cookies !== undefined) row.encrypted_cookies = input.cookies ? encryptSecret(input.cookies) : null;
  const { error } = await supabase
    .from("skp_sessions")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return { status };
}

export async function getSkpSessionStatus(supabase: SupabaseClient, userId: string): Promise<{ status: "valid" | "expired" | "unknown"; configured: boolean; lastCheckedAt: string | null }> {
  const { data, error } = await supabase
    .from("skp_sessions")
    .select("status,encrypted_storage_state,encrypted_cookies,last_checked_at,expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { status: "unknown", configured: false, lastCheckedAt: null };
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return { status: "expired", configured: Boolean(data.encrypted_storage_state || data.encrypted_cookies), lastCheckedAt: data.last_checked_at ?? null };
  }
  if (data.status === "expired" || data.status === "not_logged_in") {
    return { status: "expired", configured: Boolean(data.encrypted_storage_state || data.encrypted_cookies), lastCheckedAt: data.last_checked_at ?? null };
  }
  if ((data.status === "connected" || data.status === "valid") && (data.encrypted_storage_state || data.encrypted_cookies)) {
    return { status: "valid", configured: true, lastCheckedAt: data.last_checked_at ?? null };
  }
  return { status: "unknown", configured: Boolean(data.encrypted_storage_state || data.encrypted_cookies), lastCheckedAt: data.last_checked_at ?? null };
}

export async function getPublicSkpAuthStatus(supabase: SupabaseClient, userId: string): Promise<PublicSkpAuthStatus> {
  const [credential, session] = await Promise.all([
    getCredentialStatus(supabase, userId),
    supabase
      .from("skp_sessions")
      .select("status,encrypted_storage_state,encrypted_cookies,display_name,last_checked_at,expires_at,message")
      .eq("user_id", userId)
      .maybeSingle()
  ]);
  if (session.error) throw new Error(session.error.message);

  const row = session.data;
  const configured = Boolean(row?.encrypted_storage_state || row?.encrypted_cookies);
  const rawStatus = String(row?.status ?? "unknown");
  let status: PublicSkpAuthStatus["status"] = "not_logged_in";
  if (rawStatus === "error") status = "error";
  else if (rawStatus === "login_failed") status = "error";
  else if (rawStatus === "expired" || rawStatus === "not_logged_in" || (row?.expires_at && new Date(row.expires_at).getTime() <= Date.now())) status = "expired";
  else if ((rawStatus === "connected" || rawStatus === "valid") && configured) status = "connected";
  else status = "not_logged_in";

  return {
    status,
    isLoggedIn: status === "connected",
    username: null,
    displayName: typeof row?.display_name === "string" && row.display_name.trim() ? row.display_name : null,
    lastCheckedAt: row?.last_checked_at ?? new Date().toISOString(),
    message: publicSessionMessage(status, credential.configured, configured, row?.message),
    configured,
    credentialConfigured: credential.configured
  };
}

export async function readSkpSessionForBackend(supabase: SupabaseClient, userId: string): Promise<{ storageState: string | null; cookies: string | null }> {
  const { data, error } = await supabase
    .from("skp_sessions")
    .select("encrypted_storage_state,encrypted_cookies")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    storageState: decryptSecret(data?.encrypted_storage_state),
    cookies: decryptSecret(data?.encrypted_cookies)
  };
}

export function assertNotPlaintext(encryptedValue: string | null | undefined, plaintext: string): boolean {
  if (!encryptedValue) return false;
  const left = Buffer.from(encryptedValue);
  const right = Buffer.from(plaintext);
  return left.length !== right.length || !timingSafeEqual(left, right);
}

function credentialKey(): Buffer {
  const configured = readSupabaseConfig().credentialEncryptionKey;
  if (configured.length < 32) {
    throw new Error("SKP_CREDENTIAL_ENCRYPTION_KEY minimal 32 karakter.");
  }
  return createHash("sha256").update(configured).digest();
}

function publicSessionMessage(status: PublicSkpAuthStatus["status"], credentialConfigured: boolean, sessionConfigured: boolean, storedMessage?: string | null): string {
  if (status === "connected") return storedMessage || "Terhubung ke SKP.";
  if (!credentialConfigured) return "Kredensial belum tersedia.";
  if (status === "expired") return storedMessage || "Perlu login ulang.";
  if (status === "error") return storedMessage || "Gagal mengecek session SKP.";
  if (!sessionConfigured) return "Session SKP belum tersedia.";
  return storedMessage || "Session SKP belum bisa dipastikan.";
}
