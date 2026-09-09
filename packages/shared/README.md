# `@enterprise-idp/shared`

Shared TypeScript artifacts generated from the authoritative OpenAPI spec.

## Generate types

```bash
cd packages/shared
npm install
npm run generate
```

This reads `../../docs/spec/api/openapi.yaml` and writes generated output to
`src/generated/api.ts`.
