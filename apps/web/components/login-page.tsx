"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";

function isSafeRedirect(target: string | null): target is string {
  // Only same-origin absolute paths, so `?next=` cannot be used for an open redirect.
  return Boolean(target && target.startsWith("/") && !target.startsWith("//"));
}

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const nextParam = searchParams?.get("next") ?? null;
  const redirectTo = isSafeRedirect(nextParam) ? nextParam : "/";

  const signIn = useMutation({
    mutationFn: () => api.login({ email: email.trim(), password }),
    onSuccess: async () => {
      await refresh();
      router.replace(redirectTo);
    },
  });

  const errorMessage =
    signIn.error instanceof ApiError
      ? signIn.error.status === 401
        ? "That email or password is not correct."
        : (signIn.error.body?.message ?? "Sign in failed. Please try again.")
      : signIn.error
        ? "Sign in failed. Please try again."
        : null;

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center px-6">
        <Wordmark />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="bg-card border-border w-full max-w-md rounded-xl border p-8 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <span className="bg-muted text-primary mb-5 flex size-12 items-center justify-center rounded-xl">
              <Icon name="account_balance" size={26} />
            </span>
            <h1 className="text-headline-md">Sign in to Canada Life IDP</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              Intelligent Document Processing Platform
            </p>
          </div>

          <form
            className="mt-8 flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              signIn.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-email" className="text-label-caps text-muted-foreground">
                Work email
              </Label>
              <div className="relative">
                <Input
                  id="login-email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  autoFocus
                  placeholder="name@canadalife.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={errorMessage ? true : undefined}
                  className="pr-10"
                />
                <Icon
                  name="mail"
                  size={18}
                  className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="login-password" className="text-label-caps text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={errorMessage ? true : undefined}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                >
                  <Icon name={showPassword ? "visibility_off" : "visibility"} size={18} />
                </button>
              </div>
            </div>

            {errorMessage ? (
              <p
                role="alert"
                className="text-destructive flex items-start gap-2 text-sm"
              >
                <Icon name="error" size={16} className="mt-0.5" />
                {errorMessage}
              </p>
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={signIn.isPending}>
              {signIn.isPending ? (
                <>
                  <Icon name="progress_activity" size={18} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <p className="text-muted-foreground mt-6 flex items-center justify-center gap-1.5 text-xs">
            <Icon name="help_outline" size={14} />
            Having trouble signing in? Contact the IT helpdesk.
          </p>
        </div>
      </main>

      <footer className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs">
        <span>Strictly for authorized personnel only.</span>
        <span>© {new Date().getFullYear()} The Canada Life Assurance Company</span>
      </footer>
    </div>
  );
}
