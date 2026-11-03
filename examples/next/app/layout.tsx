import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { getToken } from "@/lib/auth-server";
import { PropsWithChildren } from "react";
import { Toaster } from "sonner";

export default async function RootLayout({ children }: PropsWithChildren) {
  const token = await getToken();
  return (
    <html lang="en" className="dark">
      <body className="bg-neutral-950 text-neutral-50">
        <ConvexClientProvider initialToken={token}>
          {children}
          <Toaster />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
