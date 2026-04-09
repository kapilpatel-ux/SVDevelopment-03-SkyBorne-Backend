const DEFAULT_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

const isProductionEnv = () =>
  process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";

const toOrigin = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/$/, "");
  }
};

const parseOriginList = (value?: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map(toOrigin)
    .filter(Boolean);
};

export const getAllowedOrigins = (): string[] => {
  const allowlist = [
    ...parseOriginList(process.env.CORS_ALLOWED_ORIGINS),
    ...[process.env.FRONTEND_URL, process.env.WEBSITE_URL]
      .filter((value): value is string => Boolean(value))
      .map(toOrigin),
  ];

  const unique = Array.from(new Set(allowlist));

  if (unique.length === 0 && !isProductionEnv()) {
    return DEFAULT_DEV_ORIGINS;
  }

  return unique;
};

export const isOriginAllowed = (
  origin: string | undefined | null,
  allowedOrigins: string[]
): boolean => {
  if (!origin) {
    return true;
  }
  return allowedOrigins.includes(origin);
};
