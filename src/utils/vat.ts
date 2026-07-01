const normalizeCountryValue = (value?: string | null): string =>
  String(value ?? "").trim().toLowerCase();

const UAE_NAME_VARIANTS = new Set([
  "united arab emirates",
  "united arab emirates (the)",
  "uae",
  "ae",
]);

export const isUnitedArabEmirates = (
  country?: string | null,
  countryCode?: string | null,
): boolean => {
  const code = normalizeCountryValue(countryCode);
  if (code === "ae") return true;

  const name = normalizeCountryValue(country);
  return UAE_NAME_VARIANTS.has(name);
};

export const getVatRateForCountry = (
  country?: string | null,
  countryCode?: string | null,
): number => (isUnitedArabEmirates(country, countryCode) ? 0.05 : 0);

const roundCurrency = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const calculateVatFromBase = (baseAmount: number, vatRate: number) => {
  const subtotal = roundCurrency(baseAmount);
  const safeRate = Number.isFinite(vatRate) ? vatRate : 0;
  const vatAmount = roundCurrency(subtotal * safeRate);
  const total = roundCurrency(subtotal + vatAmount);

  return {
    subtotal,
    vatAmount,
    total,
    vatRate: safeRate,
  };
};

export const calculateVatFromTotal = (totalAmount: number, vatRate: number) => {
  const safeRate = Number.isFinite(vatRate) ? vatRate : 0;
  const total = roundCurrency(totalAmount);

  if (!safeRate) {
    return {
      subtotal: total,
      vatAmount: 0,
      total,
      vatRate: 0,
    };
  }

  const subtotal = roundCurrency(total / (1 + safeRate));
  const vatAmount = roundCurrency(total - subtotal);

  return {
    subtotal,
    vatAmount,
    total,
    vatRate: safeRate,
  };
};
