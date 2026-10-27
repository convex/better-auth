import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  turbopack: {
    root: ".",
  },
  basePath: "/better-auth",
  reactStrictMode: true,
  redirects: async () => {
    return [
      {
        source: "/local-install",
        destination: "/features/local-install",
        permanent: true,
      },
      {
        source: "/authorization",
        destination: "/basic-usage/authorization",
        permanent: true,
      },
      {
        source: "/triggers",
        destination: "/features/triggers",
        permanent: true,
      },
    ];
  },
  rewrites: async () => {
    return [
      {
        source: "/:path*.md",
        destination: "/llms.mdx/:path*",
      },
    ];
  },
};

export default withMDX(config);
