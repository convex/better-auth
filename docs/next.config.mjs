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
      // Migration guides were consolidated into the Upgrading section
      {
        source: "/migrations",
        destination: "/upgrading",
        permanent: true,
      },
      {
        source: "/migrations/:path*",
        destination: "/upgrading",
        permanent: true,
      },
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
};

export default withMDX(config);
