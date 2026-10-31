"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { Loader2, Copy, Check, ArrowLeft } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import QRCode from "react-qr-code";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";

type SetupStep =
  | "loading"
  | "need-password"
  | "password"
  | "qr-verify"
  | "backup";

export default function EnableTwoFactor() {
  const user = useQuery(api.auth.getCurrentUser);
  const [step, setStep] = useState<SetupStep>("loading");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [totpUri, setTotpUri] = useState<string>();
  const [backupCodes, setBackupCodes] = useState<string[]>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const checkAccounts = async () => {
      const accounts = await authClient.listAccounts();
      if ("data" in accounts && accounts.data) {
        const hasCredential = accounts.data.some(
          (account) => account.providerId === "credential",
        );
        setStep(hasCredential ? "password" : "need-password");
      }
    };
    checkAccounts();
  }, []);

  const handlePasswordSubmit = async () => {
    try {
      setLoading(true);
      const { data } = await authClient.twoFactor.enable({
        password,
      });
      if (data?.method === "totp") {
        setTotpUri(data.totpURI);
        if (data.backupCodes) {
          setBackupCodes(data.backupCodes);
        }
        setStep("qr-verify");
      }
    } catch {
      alert("Failed to enable 2FA. Please check your password and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    try {
      setLoading(true);
      await authClient.twoFactor.verifyTotp({
        code,
      });
      setStep("backup");
    } catch {
      alert("Failed to verify code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const copyBackupCodes = async () => {
    if (!backupCodes) return;
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResetPassword = async () => {
    if (!user?.email) {
      alert("User email not found");
      return;
    }
    try {
      setLoading(true);
      await authClient.requestPasswordReset({
        email: user.email,
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
      });
      alert("Check your email for password reset instructions");
    } catch {
      alert("Failed to send password reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {(step === "password" || step === "need-password") && (
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 mb-4"
            onClick={() => window.location.reload()}
          >
            <ArrowLeft size={16} />
            Back to Settings
          </Button>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg md:text-xl">
              Enable Two-Factor Authentication
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {step === "loading"
                ? "Loading..."
                : step === "need-password"
                  ? "You need to set up a password before enabling 2FA"
                  : step === "password"
                    ? "Enter your password to begin setup"
                    : step === "qr-verify"
                      ? "Scan this QR code with your authenticator app"
                      : "Save these backup codes in a secure place"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "loading" && (
              <div className="flex justify-center py-4">
                <Loader2 size={24} className="animate-spin" />
              </div>
            )}

            {step === "need-password" && (
              <div className="grid gap-4">
                <p className="text-sm text-muted-foreground">
                  Two-factor authentication requires a password for additional
                  security. Since you signed up with a social account,
                  you&apos;ll need to set up a password first.
                </p>
                <Button onClick={handleResetPassword} disabled={loading}>
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Set Up Password"
                  )}
                </Button>
              </div>
            )}

            {step === "password" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePasswordSubmit();
                }}
                className="grid gap-4"
              >
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Continue"
                  )}
                </Button>
              </form>
            )}

            {step === "qr-verify" && totpUri && (
              <div className="grid gap-6">
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <QRCode value={totpUri} />
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleVerifyCode();
                  }}
                  className="grid gap-4"
                >
                  <div className="grid gap-2">
                    <Label htmlFor="code">Verification Code</Label>
                    <Input
                      id="code"
                      type="text"
                      placeholder="Enter 6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      pattern="[0-9]*"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      disabled={loading}
                    />
                  </div>
                  <Button type="submit" disabled={loading}>
                    {loading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      "Verify"
                    )}
                  </Button>
                </form>
              </div>
            )}

            {step === "backup" && backupCodes && (
              <div className="grid gap-4">
                <div className="relative p-4 bg-muted rounded-lg">
                  <pre className="text-sm font-mono whitespace-pre-line">
                    {backupCodes.join("\n")}
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2"
                    onClick={copyBackupCodes}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </Button>
                </div>
                <Button onClick={() => window.location.reload()}>Done</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
