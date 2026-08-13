# GitHub Actions Build Design

Run the repository's existing `npm run verify` gate on Node.js 20 after `npm ci` for pushes to `dev` or `main`, and for pull requests. Use `actions/checkout` and `actions/setup-node` with npm caching. Do not add deployment or artifact retention; the requested outcome is automatic verified builds on push.
