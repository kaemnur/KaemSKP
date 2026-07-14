import type { DailyLog, SkpSiteOption } from "../types";

export type SkpOptionCandidate = {
  text: string | null;
  value: string | null;
};

export function findBestSkpOption(
  log: DailyLog,
  options: SkpSiteOption[],
  siteMapping?: SkpOptionCandidate | null
): SkpSiteOption | null {
  const selectableOptions = options.filter((item) => item.text && !/^[-\s]*(pilih|select|--)/i.test(item.text));

  if (siteMapping?.value) {
    const byValue = selectableOptions.find((item) => item.value === siteMapping.value);
    if (byValue) return byValue;
  }
  if (siteMapping?.text) {
    const byMappingText = findByText(selectableOptions, siteMapping.text);
    if (byMappingText) return byMappingText;
  }

  if (log.kode_skp) {
    const normalizedCode = normalizeText(log.kode_skp);
    const byCode = selectableOptions.find((item) => normalizeText(item.text).includes(normalizedCode) || normalizeText(item.value).includes(normalizedCode));
    if (byCode) return byCode;
  }

  const name = log.nama_skp?.trim();
  if (name) {
    const byName = findByText(selectableOptions, name);
    if (byName) return byName;

    const fuzzy = selectableOptions
      .map((option) => ({ option, score: fuzzyScore(name, option.text) }))
      .sort((a, b) => b.score - a.score)[0];
    if (fuzzy && fuzzy.score >= 0.62) return fuzzy.option;
  }

  const indicator = log.indikator_kinerja_individu?.trim();
  if (indicator) {
    const byIndicator = findByText(selectableOptions, indicator);
    if (byIndicator) return byIndicator;

    const fuzzyIndicator = selectableOptions
      .map((option) => ({ option, score: fuzzyScore(indicator, option.text) }))
      .sort((a, b) => b.score - a.score)[0];
    if (fuzzyIndicator && fuzzyIndicator.score >= 0.62) return fuzzyIndicator.option;
  }

  return null;
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findByText(options: SkpSiteOption[], text: string): SkpSiteOption | null {
  const normalized = normalizeText(text);
  return (
    options.find((item) => normalizeText(item.text) === normalized) ??
    options.find((item) => normalizeText(item.text).includes(normalized) || normalized.includes(normalizeText(item.text))) ??
    null
  );
}

function fuzzyScore(left: string, right: string): number {
  const leftTokens = significantTokens(left);
  const rightTokens = significantTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const matched = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return matched / Math.max(leftTokens.length, rightTokens.length);
}

function significantTokens(value: string): string[] {
  const ignored = new Set(["nya", "dan", "atau", "yang", "data"]);
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !ignored.has(token));
}
