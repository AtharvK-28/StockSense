try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on variables from the real environment.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  /** Encrypts stored authenticator secrets. Separate from JWT_SECRET so rotating sessions doesn't break 2FA; falls back to it for existing installs. */
  totpKey: process.env.TOTP_KEY || required("JWT_SECRET"),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  isProd: process.env.NODE_ENV === "production",
  /** Secure (HTTPS-only) session cookies. Defaults to on in production; set COOKIE_SECURE=false for plain-HTTP local runs. */
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
  otpDevEcho: process.env.OTP_DEV_ECHO === "true" && process.env.NODE_ENV !== "production",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "StockSense <no-reply@stocksense.local>",
  },
};
