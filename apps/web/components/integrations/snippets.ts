import type { BusinessProcess } from "@/lib/api";

import {
  type AuthMode,
  type EndpointId,
  type GeneratedUserToken,
  type SnippetLanguage,
  SAMPLE_FILE_NAME,
  getEndpointDefinition,
  pathWithConcreteValues,
} from "@/components/integrations/endpoint-catalog";

export type AuthorizationPreview = {
  value: string | null;
  description: string;
  copyValue?: string;
};

const AUTHORIZATION_PREFIX = "Authorization: " + "Bearer ";

function cookieSnippetComment(language: SnippetLanguage) {
  switch (language) {
    case "curl":
      return `-b "cl_idp_session=<browser-session-cookie>"`;
    case "typescript":
      return `credentials: "include",`;
    case "python":
      return `cookies={"cl_idp_session": "<browser-session-cookie>"},`;
  }
}

function headerValue(authMode: AuthMode, generatedToken: GeneratedUserToken | null) {
  if (authMode === "service-token") {
    return `${AUTHORIZATION_PREFIX}$SERVICE_API_TOKEN`;
  }

  return `${AUTHORIZATION_PREFIX}${generatedToken?.accessToken ?? "<user-token>"}`;
}

function headerObjectLine(fullHeader: string) {
  const prefix = `${AUTHORIZATION_PREFIX}`;
  return `headers: { "Authorization": "${fullHeader.slice(prefix.length)}" },`;
}

export function formatTokenExpiry(token: GeneratedUserToken, now: number) {
  const remainingSeconds = Math.max(
    0,
    Math.floor((token.issuedAt + token.expiresIn * 1000 - now) / 1000),
  );

  if (remainingSeconds <= 0) {
    return "Expired — generate a fresh token.";
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  if (minutes === 0) {
    return `Expires in ${seconds}s.`;
  }

  return `Expires in ${minutes}m ${seconds}s.`;
}

export function buildAuthorizationPreview(args: {
  endpointId: EndpointId;
  authMode: AuthMode;
  generatedToken: GeneratedUserToken | null;
  now: number;
}): AuthorizationPreview {
  const { endpointId, authMode, generatedToken, now } = args;
  const endpoint = getEndpointDefinition(endpointId);

  if (endpoint.noAuthRequired) {
    return {
      value: null,
      description:
        "No Authorization header required — /auth/token validates the credentials in the JSON body.",
    };
  }

  if (authMode === "session-cookie") {
    return {
      value: null,
      description:
        "No Authorization header needed — the browser sends the httpOnly cl_idp_session cookie automatically with credentials: 'include'.",
    };
  }

  if (authMode === "user-token") {
    if (!generatedToken) {
      return {
        value: `${AUTHORIZATION_PREFIX}<generate a token below>`,
        description:
          "Generate a short-lived user token in the Authentication section to replace this placeholder.",
      };
    }

    const header = `${AUTHORIZATION_PREFIX}${generatedToken.accessToken}`;
    return {
      value: header,
      copyValue: header,
      description: formatTokenExpiry(generatedToken, now),
    };
  }

  return {
    value: `${AUTHORIZATION_PREFIX}$SERVICE_API_TOKEN`,
    copyValue: `${AUTHORIZATION_PREFIX}$SERVICE_API_TOKEN`,
    description:
      "Template only — service tokens are configured out-of-band and are never exposed back to the UI.",
  };
}

export function generateSnippet(args: {
  language: SnippetLanguage;
  endpointId: EndpointId;
  process: BusinessProcess;
  authMode: AuthMode;
  generatedToken: GeneratedUserToken | null;
}): string {
  const { language, endpointId, process, authMode, generatedToken } = args;
  const endpoint = getEndpointDefinition(endpointId);
  const url = pathWithConcreteValues(process, endpointId);
  const authHeader = headerValue(authMode, generatedToken);

  switch (language) {
    case "curl":
      switch (endpointId) {
        case "auth-token":
          return [
            `curl -X ${endpoint.method} ${url} \\`,
            `  -H "Content-Type: application/json" \\`,
            `  -d '{`,
            `    "email": "ada@example.com",`,
            `    "password": "••••••••"`,
            `  }'`,
          ].join("\n");
        case "trigger-job":
          return [
            `curl -X ${endpoint.method} ${url} \\`,
            `  -H "${authHeader}" \\`,
            `  -F "file=@${SAMPLE_FILE_NAME};type=application/pdf"`,
          ].join("\n");
        case "list-jobs":
          return [
            `curl ${url}?status=running&limit=20 \\`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("curl")}`
              : `  -H "${authHeader}"`,
          ].join("\n");
        case "jobs-summary":
          return [
            `curl ${url}?hasViolations=true \\`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("curl")}`
              : `  -H "${authHeader}"`,
          ].join("\n");
        case "get-job":
          return [
            `curl ${url} \\`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("curl")}`
              : `  -H "${authHeader}"`,
          ].join("\n");
        case "retry-job":
          return [
            `curl -X ${endpoint.method} ${url} \\`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("curl")}`
              : `  -H "${authHeader}"`,
          ].join("\n");
      }
    case "typescript":
      switch (endpointId) {
        case "auth-token":
          return [
            `const response = await fetch("${url}", {`,
            `  method: "POST",`,
            `  headers: { "Content-Type": "application/json" },`,
            `  body: JSON.stringify({`,
            `    email: "ada@example.com",`,
            `    password: "••••••••",`,
            `  }),`,
            `});`,
            ``,
            `const token = await response.json();`,
          ].join("\n");
        case "trigger-job":
          return [
            `const formData = new FormData();`,
            `formData.append("file", file, "${SAMPLE_FILE_NAME}");`,
            ``,
            `const response = await fetch("${url}", {`,
            `  method: "POST",`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("typescript")}`
              : `  ${headerObjectLine(authHeader)}`,
            `  body: formData,`,
            `});`,
            ``,
            `const receipt = await response.json();`,
          ].join("\n");
        case "list-jobs":
          return [
            `const response = await fetch("${url}?status=running&limit=20", {`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("typescript")}`
              : `  ${headerObjectLine(authHeader)}`,
            `});`,
            ``,
            `const jobs = await response.json();`,
          ].join("\n");
        case "jobs-summary":
          return [
            `const response = await fetch("${url}?hasViolations=true", {`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("typescript")}`
              : `  ${headerObjectLine(authHeader)}`,
            `});`,
            ``,
            `const summary = await response.json();`,
          ].join("\n");
        case "get-job":
          return [
            `const response = await fetch("${url}", {`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("typescript")}`
              : `  ${headerObjectLine(authHeader)}`,
            `});`,
            ``,
            `const job = await response.json();`,
          ].join("\n");
        case "retry-job":
          return [
            `const response = await fetch("${url}", {`,
            `  method: "POST",`,
            authMode === "session-cookie"
              ? `  ${cookieSnippetComment("typescript")}`
              : `  ${headerObjectLine(authHeader)}`,
            `});`,
            ``,
            `const retryReceipt = await response.json();`,
          ].join("\n");
      }
    case "python":
      switch (endpointId) {
        case "auth-token":
          return [
            `import requests`,
            ``,
            `response = requests.post(`,
            `    "${url}",`,
            `    json={"email": "ada@example.com", "password": "••••••••"},`,
            `    timeout=30,`,
            `)`,
            `response.raise_for_status()`,
            `token = response.json()`,
          ].join("\n");
        case "trigger-job":
          return [
            `import requests`,
            ``,
            `with open("${SAMPLE_FILE_NAME}", "rb") as file_handle:`,
            `    response = requests.post(`,
            `        "${url}",`,
            authMode === "session-cookie"
              ? `        ${cookieSnippetComment("python")}`
              : `        headers={"Authorization": "${authHeader.replace(AUTHORIZATION_PREFIX, "")}"},`,
            `        files={"file": ("${SAMPLE_FILE_NAME}", file_handle, "application/pdf")},`,
            `        timeout=60,`,
            `    )`,
            ``,
            `response.raise_for_status()`,
            `receipt = response.json()`,
          ].join("\n");
        case "list-jobs":
          return [
            `import requests`,
            ``,
            `response = requests.get(`,
            `    "${url}",`,
            authMode === "session-cookie"
              ? `    ${cookieSnippetComment("python")}`
              : `    headers={"Authorization": "${authHeader.replace(AUTHORIZATION_PREFIX, "")}"},`,
            `    params={"status": "running", "limit": 20},`,
            `    timeout=30,`,
            `)`,
            `response.raise_for_status()`,
            `jobs = response.json()`,
          ].join("\n");
        case "jobs-summary":
          return [
            `import requests`,
            ``,
            `response = requests.get(`,
            `    "${url}",`,
            authMode === "session-cookie"
              ? `    ${cookieSnippetComment("python")}`
              : `    headers={"Authorization": "${authHeader.replace(AUTHORIZATION_PREFIX, "")}"},`,
            `    params={"hasViolations": "true"},`,
            `    timeout=30,`,
            `)`,
            `response.raise_for_status()`,
            `summary = response.json()`,
          ].join("\n");
        case "get-job":
          return [
            `import requests`,
            ``,
            `response = requests.get(`,
            `    "${url}",`,
            authMode === "session-cookie"
              ? `    ${cookieSnippetComment("python")}`
              : `    headers={"Authorization": "${authHeader.replace(AUTHORIZATION_PREFIX, "")}"},`,
            `    timeout=30,`,
            `)`,
            `response.raise_for_status()`,
            `job = response.json()`,
          ].join("\n");
        case "retry-job":
          return [
            `import requests`,
            ``,
            `response = requests.post(`,
            `    "${url}",`,
            authMode === "session-cookie"
              ? `    ${cookieSnippetComment("python")}`
              : `    headers={"Authorization": "${authHeader.replace(AUTHORIZATION_PREFIX, "")}"},`,
            `    timeout=30,`,
            `)`,
            `response.raise_for_status()`,
            `retry_receipt = response.json()`,
          ].join("\n");
      }
  }
}
