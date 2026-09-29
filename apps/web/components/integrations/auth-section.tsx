"use client";

import { useState } from "react";

import { SectionHeader } from "@/components/brand/primitives";
import { CopyButton } from "@/components/integrations/copy-button";
import { type GeneratedUserToken } from "@/components/integrations/endpoint-catalog";
import { formatTokenExpiry } from "@/components/integrations/snippets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, type AuthUser } from "@/lib/api";

export function AuthenticationSection({
  sessionUser,
  generatedToken,
  onGeneratedToken,
  now,
}: {
  sessionUser: AuthUser | null;
  generatedToken: GeneratedUserToken | null;
  onGeneratedToken: (token: GeneratedUserToken | null) => void;
  now: number;
}) {
  const [email, setEmail] = useState("");
  const [emailDirty, setEmailDirty] = useState(false);
  const [password, setPassword] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const resolvedEmail = emailDirty ? email : sessionUser?.email ?? email;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Authentication"
        description="Choose the caller mode that matches your integration: first-party browser, ad-hoc user script, or service-to-service automation."
      />

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Icon name="verified_user" size={18} className="text-primary" />
              <CardTitle>Browser session</CardTitle>
            </div>
            <CardDescription>
              First-party web UI calls use the httpOnly session cookie set by POST /auth/login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Requests use <code className="font-mono text-foreground">credentials: &quot;include&quot;</code>,
              so nothing sensitive is exposed to JavaScript.
            </p>
            <p>
              The integrations console mirrors that browser behavior when you choose{" "}
              <strong className="text-foreground">Session cookie</strong>.
            </p>
            <Badge variant="neutral">Cookie managed automatically</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Icon name="token" size={18} className="text-primary" />
              <CardTitle>User API token</CardTitle>
            </div>
            <CardDescription>
              Best for scripts and testing. Tokens are minted from POST /auth/token and kept in memory only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setIsGenerating(true);
                setErrorMessage(null);

                try {
                  const token = await api.getAuthToken({ email: resolvedEmail, password });
                  onGeneratedToken({
                    ...token,
                    issuedAt: Date.now(),
                    email: resolvedEmail,
                  });
                  setPassword("");
                } catch (error) {
                  setErrorMessage(
                    error instanceof ApiError ? error.message : "The token could not be generated.",
                  );
                } finally {
                  setIsGenerating(false);
                }
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="user-token-email">Email</Label>
                <Input
                  id="user-token-email"
                  type="email"
                  autoComplete="username"
                  value={resolvedEmail}
                  onChange={(event) => {
                    setEmailDirty(true);
                    setEmail(event.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-token-password">Password</Label>
                <Input
                  id="user-token-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Re-enter your password"
                />
              </div>
              <Button
                type="submit"
                disabled={isGenerating || resolvedEmail.trim() === "" || password.trim() === ""}
              >
                <Icon name={isGenerating ? "autorenew" : "vpn_key"} size={16} className={isGenerating ? "animate-spin" : undefined} />
                {isGenerating ? "Generating..." : "Generate a token"}
              </Button>
            </form>

            {errorMessage ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}

            {generatedToken ? (
              <div className="space-y-2 rounded-lg border border-border/70 bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Current token</p>
                  <CopyButton value={generatedToken.accessToken} label="Copy token" copiedLabel="Copied" size="xs" />
                </div>
                <code className="block break-all font-mono text-xs text-foreground">
                  {generatedToken.accessToken}
                </code>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline">{generatedToken.tokenType}</Badge>
                  <span>{formatTokenExpiry(generatedToken, now)}</span>
                  <span>Shown once for this browser session and cleared on refresh.</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {sessionUser
                  ? `Signed in as ${sessionUser.displayName}; re-enter your password to mint a short-lived token.`
                  : "Enter an email and password to mint a short-lived token."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Icon name="lock" size={18} className="text-primary" />
              <CardTitle>Service token</CardTitle>
            </div>
            <CardDescription>
              Trusted system-to-system callers use the shared SERVICE_API_TOKEN secret configured outside the UI.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              There is no endpoint that returns the service token value, and this screen never attempts to fetch one.
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-3 text-[12px] leading-6 text-foreground">
              <code>Authorization: Bearer $SERVICE_API_TOKEN</code>
            </pre>
            <p>
              Service-token callers bypass user-role checks on retry and review routes because they represent trusted automation.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
