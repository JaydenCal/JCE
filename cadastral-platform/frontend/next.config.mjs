/** @type {import('next').NextConfig} */
export default { reactStrictMode: true, transpilePackages: ["three"], distDir: process.env.NEXT_DIST || ".next" };
