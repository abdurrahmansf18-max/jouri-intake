export function formatPrice(amount?: string, currency = "EUR"): string {
  const value = (amount ?? "").trim();
  if (!value) return "";
  const normalizedCurrency = (currency || "EUR").trim().toUpperCase();
  const symbol = normalizedCurrency === "EUR" ? "€" : normalizedCurrency;
  return `${symbol} ${value}`;
}
