# GitHub Actions Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically verify and build pushes to `dev` and `main`, plus pull requests.

**Architecture:** One GitHub Actions workflow installs the locked npm dependency tree on Node.js 20 and delegates all checks to the repository's existing `npm run verify` script.

**Tech Stack:** GitHub Actions, Node.js 20, npm.

## Global Constraints

- Add no dependencies.
- Do not deploy or retain build artifacts.
- Reuse `npm run verify` as the single CI gate.

---

### Task 1: Add the build workflow

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `package-lock.json`, package script `verify`
- Produces: GitHub Actions workflow `Build`

- [ ] **Step 1: Add the workflow**

```yaml
name: Build

on:
  push:
    branches: [dev, main]
  pull_request:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run verify
```

- [ ] **Step 2: Verify locally**

Run: `npm run verify`

Expected: asset and ability checks, both typechecks, all tests, and Vite production build pass.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml docs/superpowers
git commit -m "ci: verify builds on push"
```
