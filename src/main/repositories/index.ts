import type { DataRepository } from "./dataRepository";
import { requestedBackend } from "./dataRepository";
import { canCreateSupabaseRepository, createSupabaseRepository } from "./supabaseRepository";
import { createSqliteRepository } from "./sqliteRepository";

let repository: DataRepository | null = null;

export function getRepository(): DataRepository {
  if (repository) return repository;
  if (requestedBackend() === "supabase") {
    if (canCreateSupabaseRepository()) {
      repository = createSupabaseRepository();
      return repository;
    }
    repository = createSqliteRepository(true);
    return repository;
  }
  repository = createSqliteRepository(false);
  return repository;
}

export function resetRepositoryForTests(): void {
  repository = null;
}
