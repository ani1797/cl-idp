---
applyTo: "docs/spec/screen/**"
---

# Screen Spec Convention

Each screen doc in `docs/spec/screen/` has YAML frontmatter and a body:

```markdown
---
page: <id>
---

<Description of the screen: purpose, layout, integrations, interactions.>
```

- `page` — unique identifier for the screen (e.g., `onboarding-form`,
  `inference-review`).
- Body — free-form description of the screen's purpose, layout, integrations
  with backend/services, and user interactions.
