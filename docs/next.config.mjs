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
      // Migration guides were consolidated into a single upgrade guide
      {
        source: "/migrations",
        destination: "/upgrading",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-12",
        destination: "/upgrading",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-11",
        destination: "/upgrading",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-10",
        destination: "/upgrading",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-9",
        destination: "/upgrading",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-8",
        destination: "/upgrading/migrate-to-0-8",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-9/migrate-userid",
        destination: "/upgrading/migrate-userid",
        permanent: true,
      },
      {
        source: "/migrations/migrate-to-0-9/migrate-userid/:slug",
        destination: "/upgrading/migrate-userid/:slug",
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
