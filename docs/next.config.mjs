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
      // Migration guides were consolidated into the Upgrading section. Each
      // old "migrate to 0.N" guide was for readers on 0.(N-1), so it maps to
      // that version's upgrade guide; the rest go to the Upgrading index.
      {
        source: "/migrations",
        destination: "/upgrading",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-12",
        destination: "/upgrading/from-0-11",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-11",
        destination: "/upgrading/from-0-10",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-10",
        destination: "/upgrading/from-0-9",
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
