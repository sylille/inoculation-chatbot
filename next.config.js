// next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Enable experimental server actions if needed later
  experimental: {
    serverActions: true,
  },

  // If you want to allow importing audio files directly
  webpack(config) {
    config.module.rules.push({
      test: /\.(mp3|wav|webm|ogg)$/,
      type: "asset/resource",
    })
    return config
  },

  // Optional: Increase body size limits for API routes (audio uploads)
  api: {
    bodyParser: false, // we’re using formidable instead
    externalResolver: true,
  },
}

module.exports = nextConfig
