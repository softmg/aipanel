import type { NextConfig } from "next";

const allowedDevOrigins = process.env.AIPANEL_ALLOWED_DEV_ORIGINS
  ? process.env.AIPANEL_ALLOWED_DEV_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : undefined;

const nextConfig: NextConfig = {
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
};

export default nextConfig;
