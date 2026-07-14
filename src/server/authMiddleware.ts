import type { NextFunction, Request, Response } from "express";
import { createPublicSupabaseClient } from "../main/supabase/config";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export type AuthenticatedRequest = Request & {
  authUser: AuthenticatedUser;
};

export function getBearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function requireSupabaseAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, message: "Login Supabase diperlukan." });
    return;
  }

  const supabase = createPublicSupabaseClient();
  if (!supabase) {
    res.status(500).json({ ok: false, message: "Konfigurasi Supabase Auth belum lengkap." });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ ok: false, message: "Token Supabase tidak valid atau sudah kedaluwarsa." });
    return;
  }

  (req as AuthenticatedRequest).authUser = {
    id: data.user.id,
    email: data.user.email ?? null
  };
  next();
}

export function requireAuthenticatedRequest(req: Request): AuthenticatedRequest {
  if (!(req as Partial<AuthenticatedRequest>).authUser?.id) {
    throw new Error("Request belum terautentikasi.");
  }
  return req as AuthenticatedRequest;
}
