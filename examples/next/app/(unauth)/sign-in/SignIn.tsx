"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [signInMethod, setSignInMethod] = useState<"password" | "passwordless">(
    "passwordless",
  );
  const [otpSent, setOtpSent] = useState(false);
  const [anonymousLoading, setAnonymousLoading] = useState(false);

  const handleSignIn = async () => {
    await authClient.signIn.email(
      {
        email,
        password,
      },
      {
        onRequest: () => {
          setOtpLoading(true);
        },
        onSuccess: (ctx) => {
          setOtpLoading(false);
          if (ctx.data.twoFactorRedirect) {
            router.push("/verify-2fa");
          } else {
            router.push("/");
          }
        },
        onError: (ctx) => {
          setOtpLoading(false);
          alert(ctx.error.message);
        },
      },
    );
  };

  const handleResetPassword = async () => {
    setForgotLoading(true);
    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
      });
      alert("Check your email for the reset password link!");
    } catch {
      alert("Failed to send reset password link. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleAnonymousSignIn = async () => {
    await authClient.signIn.anonymous(
      {},
      {
        onRequest: () => {
          setAnonymousLoading(true);
        },
        onSuccess: () => {
          setAnonymousLoading(false);
          router.push("/");
        },
        onError: (ctx) => {
          setAnonymousLoading(false);
          alert(ctx.error.message);
        },
      },
    );
  };

  const handleMagicLinkSignIn = async () => {
    await authClient.signIn.magicLink(
      {
        email,
      },
      {
        onRequest: () => {
          setMagicLinkLoading(true);
        },
        onSuccess: () => {
          setMagicLinkLoading(false);
          alert("Check your email for the magic link!");
        },
        onError: (ctx) => {
          setMagicLinkLoading(false);
          alert(ctx.error.message);
        },
      },
    );
  };

  const handleGithubSignIn = async () => {
    await authClient.signIn.social(
      {
        provider: "github",
      },
      {
        onRequest: () => {
          setOtpLoading(true);
        },
        onResponse: () => setOtpLoading(false),
        onSuccess: () => {
          router.push("/");
        },
        onError: (ctx) => {
          alert(ctx.error.message);
        },
      },
    );
  };

  const handleGoogleSignIn = async () => {
    await authClient.signIn.social(
      {
        provider: "google",
      },
      {
        onRequest: () => {
          setOtpLoading(true);
        },
        onSuccess: () => {
          setOtpLoading(false);
        },
        onError: (ctx) => {
          setOtpLoading(false);
          alert(ctx.error.message);
        },
      },
    );
  };

  const handleSlackSignIn = async () => {
    await authClient.signIn.social(
      {
        provider: "slack",
      },
      {
        onRequest: () => {
          setOtpLoading(true);
        },
        onSuccess: () => {
          setOtpLoading(false);
        },
        onError: (ctx) => {
          setOtpLoading(false);
          alert(ctx.error.message);
        },
      },
    );
  };

  const handleOtpSignIn = async () => {
    if (!otpSent) {
      await authClient.emailOtp.sendVerificationOtp(
        {
          email,
          type: "sign-in",
        },
        {
          onRequest: () => {
            setOtpLoading(true);
          },
          onSuccess: () => {
            setOtpLoading(false);
            setOtpSent(true);
          },
          onError: (ctx) => {
            setOtpLoading(false);
            alert(ctx.error.message);
          },
        },
      );
    } else {
      await authClient.signIn.emailOtp(
        {
          email,
          otp,
        },
        {
          onRequest: () => {
            setOtpLoading(true);
          },
          onSuccess: () => {
            setOtpLoading(false);
            router.push("/");
          },
          onError: (ctx) => {
            setOtpLoading(false);
            alert(ctx.error.message);
          },
        },
      );
    }
  };

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">Sign In</CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Enter your email below to login to your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (signInMethod === "password") {
              handleSignIn();
            } else if (otpSent) {
              handleOtpSignIn();
            }
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="m@example.com"
              required
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              value={email}
            />
          </div>

          {signInMethod === "password" && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Button
                  variant="link"
                  size="sm"
                  type="button"
                  onClick={handleResetPassword}
                  className="cursor-pointer"
                  disabled={forgotLoading || !email}
                >
                  {forgotLoading ? (
                    <Loader2 size={14} className="animate-spin mr-1" />
                  ) : null}
                  Forgot your password?
                </Button>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="password"
                autoComplete="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {signInMethod === "passwordless" && otpSent && (
            <div className="grid gap-2">
              <Label htmlFor="otp">Verification Code</Label>
              <Input
                id="otp"
                type="text"
                placeholder="Enter verification code"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength={6}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {signInMethod === "password" && (
              <Button type="submit" className="w-full" disabled={otpLoading}>
                Sign in with Password
              </Button>
            )}
            <Button
              type="button"
              className="w-full"
              disabled={anonymousLoading}
              onClick={handleAnonymousSignIn}
            >
              Sign in anonymously
            </Button>
            {signInMethod === "passwordless" && !otpSent && (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  className="w-full"
                  disabled={magicLinkLoading || otpLoading}
                  onClick={handleMagicLinkSignIn}
                >
                  {magicLinkLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Send Magic Link"
                  )}
                </Button>
                <Button
                  type="button"
                  className="w-full"
                  variant="outline"
                  disabled={magicLinkLoading || otpLoading}
                  onClick={handleOtpSignIn}
                >
                  {otpLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Send Verification Code"
                  )}
                </Button>
              </div>
            )}
            {signInMethod === "passwordless" && otpSent && (
              <Button type="submit" className="w-full" disabled={otpLoading}>
                {otpLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "Verify Code"
                )}
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              className="text-sm"
              onClick={() => {
                setSignInMethod(
                  signInMethod === "password" ? "passwordless" : "password",
                );
                setPassword("");
                setOtp("");
                setOtpSent(false);
              }}
            >
              {signInMethod === "password"
                ? "Sign in with magic link or OTP instead"
                : "Sign in with a password instead"}
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-neutral-800" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-neutral-500">
                or continue with
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={otpLoading}
            onClick={handleGithubSignIn}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="1em"
              height="1em"
              viewBox="0 0 24 24"
            >
              <path
                fill="currentColor"
                d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
              />
            </svg>
            Sign in with Github
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={otpLoading}
            onClick={handleGoogleSignIn}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="0.98em"
              height="1em"
              viewBox="0 0 256 262"
            >
              <path
                fill="#4285F4"
                d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
              />
              <path
                fill="#34A853"
                d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
              />
              <path
                fill="#FBBC05"
                d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z"
              />
              <path
                fill="#EB4335"
                d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
              />
            </svg>
            Sign in with Google
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={otpLoading}
            onClick={handleSlackSignIn}
          >
            Sign in with Slack
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <div className="flex justify-center w-full border-t py-4">
          <p className="text-center text-xs text-neutral-500">
            Powered by{" "}
            <a
              href="https://better-auth.com"
              className="underline"
              target="_blank"
            >
              <span className="dark:text-orange-200/90">better-auth.</span>
            </a>
          </p>
        </div>
      </CardFooter>
    </Card>
  );
}
