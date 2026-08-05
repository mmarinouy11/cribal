/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Run instrumentation.ts on server start (boots the in-process pipeline cron).
    instrumentationHook: true,
    // pdf-parse (and its pdfjs dependency) are Node-only and must not be bundled
    // by Next — keep them external so the chat's PDF extraction works at runtime
    // in the Node.js server.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
}

export default nextConfig
