import SignIn from "./SignIn";
import SignUp from "./SignUp";
import ResetPassword from "./ResetPassword";
import { Dashboard } from "./components/Dashboard";
import { useState } from "react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";

export default function App() {
  return (
    <>
      <AuthLoading>
        <div data-testid="auth-loading">Loading...</div>
      </AuthLoading>
      <Authenticated>
        <div data-testid="auth-authenticated">
          <Dashboard />
        </div>
      </Authenticated>
      <Unauthenticated>
        <div data-testid="auth-unauthenticated">
          <SignInForm />
        </div>
      </Unauthenticated>
    </>
  );
}

function SignInForm() {
  const [showSignIn, setShowSignIn] = useState(true);
  if (window.location.pathname === "/reset-password") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <ResetPassword />
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {showSignIn ? <SignIn /> : <SignUp />}
        <p className="text-center mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          {showSignIn
            ? "Don't have an account? "
            : "Already have an account? "}
          <button
            onClick={() => setShowSignIn(!showSignIn)}
            className="text-orange-400 hover:text-orange-500 dark:text-orange-300 dark:hover:text-orange-200 underline"
          >
            {showSignIn ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
