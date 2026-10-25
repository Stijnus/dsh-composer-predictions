# Releasing

Releases are cut by pushing a tag; `.github/workflows/release.yml` tests the
commit and publishes it to npm with a provenance attestation.

Trusted publishing was configured and validated on 2026-10-25 by the successful
GitHub Actions publication of 1.2.1 with npm provenance. Future new version tags
use this connection; no npm token is stored in GitHub.

## One-time setup: trusted publishing

The workflow authenticates with OIDC, so no `NPM_TOKEN` secret is needed — but
npm must be told which repository and workflow may publish.

1. Open <https://www.npmjs.com/package/dsh-composer-predictions> → **Settings**.
2. Under **Trusted publishing**, add a **GitHub Actions** publisher:
   - Organization or user: `Stijnus`
   - Repository: `dsh-composer-predictions`
   - Workflow filename: `release.yml`
   - Environment: leave empty
   - Allowed actions: enable direct `npm publish`
3. Save. Complete the first successful publication within two days, before a
   new publisher configuration expires.

Until this exists, a tag for an unpublished version fails at the publish step
with an authentication error. The existing bypass-2FA publishing token cannot
manage trusted publishers (`npm trust` returns 403); use an interactive npm
login with account 2FA for this one-time setup. Do not copy the token into GitHub.

## Cut a release

```bash
# 1. Version and changelog
npm version patch --no-git-tag-version   # or minor / major
#   move the [Unreleased] entries in CHANGELOG.md under the new version

# 2. Ship it
git add -A
git commit -m "1.2.0: <summary>"
git tag -a v1.2.0 -m "1.2.0"
git push origin main
git push origin v1.2.0
```

The tag push starts the workflow: it checks that the tag matches
`package.json`, runs `npm test`, then publishes with provenance.

## Market index

`market-index.json` is a DSH format-1 market index that lists this package, so a
Discover tab can show it. After npm confirms the new version, bump `plugins[0].versions[0]` (version and
`publishTimestamp` in Unix seconds) in a follow-up commit:

```bash
npm view dsh-composer-predictions time --json   # exact publish time
```

Commit and push the index update only after the published version is visible.
Do not run manual publication concurrently with the workflow. If trusted
publishing is unavailable, publish locally first and push the tag after npm
confirms it; the workflow verifies the existing package and skips republishing.

Index URL: https://raw.githubusercontent.com/Stijnus/dsh-composer-predictions/main/market-index.json

## Verify

```bash
npm view dsh-composer-predictions version
npm view dsh-composer-predictions@1.2.0 dist.attestations
```

The npm package page also shows a **Provenance** badge linking the published
tarball to the workflow run.

## Notes

- npm publishes asynchronously: a `202` from the registry can take minutes to
  appear in `npm view`, so a slow `latest` bump is not a failure. Do not retry
  while the previous publish is still processing.
- Fallback without trusted publishing: add an `NPM_TOKEN` repository secret with
  publish rights and give `actions/setup-node` a `registry-url`, then set
  `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish step. Prefer OIDC.
- `0.0.0-stage` is npm's stub from staged publishing, deprecated in favour of
  current versions; it is not a release.
