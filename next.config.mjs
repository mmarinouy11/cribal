/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse (and its pdfjs dependency) are Node-only and must not be bundled by
  // Next — keep them external so the chat's PDF extraction works at runtime in the
  // Node.js server.
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
}

export default nextConfig
