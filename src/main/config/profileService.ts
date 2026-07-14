import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../db/database";

const PROFILE_FILE = "profile.json";
const PASSWORD_MASK = "********";

export type LocalProfile = {
  namaPegawai: string;
  nipUsername: string;
  unitKerja: string;
  jabatan: string;
  tahunSkpAktif: string;
  periodeSkp: string;
  baseUrlSkp: string;
  passwordEncrypted?: string;
  passwordIv?: string;
  passwordTag?: string;
  updatedAt?: string;
};

export type PublicProfile = Omit<LocalProfile, "passwordEncrypted" | "passwordIv" | "passwordTag"> & {
  password: string;
  hasPassword: boolean;
  storagePath: string;
};

export type ProfileInput = Partial<Omit<LocalProfile, "passwordEncrypted" | "passwordIv" | "passwordTag">> & {
  password?: string;
};

export type ResolvedSkpConfig = {
  username: string | null;
  password: string | null;
  baseUrl: string;
  source: "profile" | "settings" | "env" | "default";
};

export function getProfilePath(): string {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, PROFILE_FILE);
}

export function readProfile(): LocalProfile {
  const path = getProfilePath();
  if (!existsSync(path)) return emptyProfile();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalProfile>;
    return { ...emptyProfile(), ...raw };
  } catch {
    return emptyProfile();
  }
}

export function readPublicProfile(): PublicProfile {
  const profile = readProfile();
  return {
    namaPegawai: profile.namaPegawai,
    nipUsername: profile.nipUsername,
    unitKerja: profile.unitKerja,
    jabatan: profile.jabatan,
    tahunSkpAktif: profile.tahunSkpAktif,
    periodeSkp: profile.periodeSkp,
    baseUrlSkp: profile.baseUrlSkp,
    updatedAt: profile.updatedAt,
    password: profile.passwordEncrypted ? PASSWORD_MASK : "",
    hasPassword: Boolean(profile.passwordEncrypted),
    storagePath: getProfilePath()
  };
}

export function saveProfile(input: ProfileInput): PublicProfile {
  const current = readProfile();
  const next: LocalProfile = {
    ...current,
    namaPegawai: clean(input.namaPegawai ?? current.namaPegawai),
    nipUsername: clean(input.nipUsername ?? current.nipUsername),
    unitKerja: clean(input.unitKerja ?? current.unitKerja),
    jabatan: clean(input.jabatan ?? current.jabatan),
    tahunSkpAktif: clean(input.tahunSkpAktif ?? current.tahunSkpAktif),
    periodeSkp: clean(input.periodeSkp ?? current.periodeSkp),
    baseUrlSkp: clean(input.baseUrlSkp ?? current.baseUrlSkp),
    updatedAt: new Date().toISOString()
  };

  if (input.password !== undefined && input.password !== PASSWORD_MASK) {
    const password = clean(input.password);
    if (password) {
      const encrypted = encryptPassword(password);
      next.passwordEncrypted = encrypted.passwordEncrypted;
      next.passwordIv = encrypted.passwordIv;
      next.passwordTag = encrypted.passwordTag;
    } else {
      delete next.passwordEncrypted;
      delete next.passwordIv;
      delete next.passwordTag;
    }
  }

  writeFileSync(getProfilePath(), JSON.stringify(next, null, 2), "utf8");
  return readPublicProfile();
}

export function deleteProfileCredentials(): PublicProfile {
  const profile = readProfile();
  delete profile.passwordEncrypted;
  delete profile.passwordIv;
  delete profile.passwordTag;
  profile.nipUsername = "";
  profile.updatedAt = new Date().toISOString();
  writeFileSync(getProfilePath(), JSON.stringify(profile, null, 2), "utf8");
  return readPublicProfile();
}

export function deleteProfile(): PublicProfile {
  rmSync(getProfilePath(), { force: true });
  return readPublicProfile();
}

export function getProfilePassword(): string | null {
  const profile = readProfile();
  if (!profile.passwordEncrypted || !profile.passwordIv || !profile.passwordTag) return null;
  return decryptPassword(profile.passwordEncrypted, profile.passwordIv, profile.passwordTag);
}

export function resolveSkpConfig(settings: Record<string, string> = process.env as Record<string, string>): ResolvedSkpConfig {
  const profile = readProfile();
  const hasProfile = existsSync(getProfilePath());
  const profileUsername = clean(profile.nipUsername);
  const profilePassword = getProfilePassword();
  const settingsUsername = clean(settings.skp_username);
  const settingsPassword = cleanPassword(settings.skp_password);
  const envUsername = clean(process.env.SKP_USERNAME);
  const envPassword = clean(process.env.SKP_PASSWORD);
  const hasProfileCredential = Boolean(profileUsername && profilePassword);
  const hasEnvCredential = Boolean(envUsername && envPassword);
  const hasLegacySettingsCredential = Boolean(settingsUsername && settingsPassword);
  const username = hasProfileCredential ? profileUsername : hasEnvCredential ? envUsername : hasLegacySettingsCredential ? settingsUsername : null;
  const password = hasProfileCredential ? profilePassword : hasEnvCredential ? envPassword : hasLegacySettingsCredential ? settingsPassword : null;
  const baseUrl = normalizeBaseUrl((hasProfile && clean(profile.baseUrlSkp)) || settings.skp_base_url || process.env.SKP_BASE_URL);
  const source = hasProfileCredential ? "profile" : hasEnvCredential ? "env" : hasLegacySettingsCredential ? "settings" : "default";

  return {
    username,
    password,
    baseUrl,
    source
  };
}

function emptyProfile(): LocalProfile {
  return {
    namaPegawai: "",
    nipUsername: "",
    unitKerja: "",
    jabatan: "",
    tahunSkpAktif: "",
    periodeSkp: "",
    baseUrlSkp: "https://skp.sdm.kemendikdasmen.go.id"
  };
}

function encryptPassword(password: string): Pick<LocalProfile, "passwordEncrypted" | "passwordIv" | "passwordTag"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", localSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return {
    passwordEncrypted: encrypted.toString("base64"),
    passwordIv: iv.toString("base64"),
    passwordTag: cipher.getAuthTag().toString("base64")
  };
}

function decryptPassword(passwordEncrypted: string, passwordIv: string, passwordTag: string): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", localSecret(), Buffer.from(passwordIv, "base64"));
    decipher.setAuthTag(Buffer.from(passwordTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(passwordEncrypted, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function localSecret(): Buffer {
  const material = [process.env.USERNAME, process.env.USERDOMAIN, process.env.COMPUTERNAME, getDataDir()].filter(Boolean).join("|");
  return createHash("sha256").update(material).digest();
}

function clean(value?: string | null): string {
  return String(value ?? "").trim();
}

function cleanPassword(value?: string | null): string | null {
  const text = clean(value);
  return text && text !== PASSWORD_MASK ? text : null;
}

function normalizeBaseUrl(value?: string | null): string {
  return (clean(value) || "https://skp.sdm.kemendikdasmen.go.id").replace(/\/+$/, "");
}
