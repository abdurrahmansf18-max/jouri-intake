export function formatPrice(amount?: string, currency = "EUR"): string {
  const value = (amount ?? "").trim();
  if (!value) return "";
  const normalizedCurrency = (currency || "EUR").trim().toUpperCase();
  const symbol = normalizedCurrency === "EUR" ? "€" : normalizedCurrency;
  return `${symbol} ${value}`;
}

export function parsePriceAmount(amount?: string): number | null {
  const value = (amount ?? "").trim();
  if (!value) return null;

  const cleaned = value
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
