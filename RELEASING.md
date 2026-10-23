# Releasing

Releases are cut by pushing a tag; `.github/workflows/release.yml` tests the
commit and publishes it to npm with a provenance attestation.

## One-time setup: trusted publishing

The workflow authenticates with OIDC, so no `NPM_TOKEN` secret is needed — but
npm must be told which repository and workflow may publish.

1. Open <https://www.npmjs.com/package/dsh-composer-predictions> → **Settings**.
2. Under **Trusted publishing**, add a **GitHub Actions** publisher:
   - Organization or user: `Stijnus`
   - Repository: `dsh-composer-predictions`
   - Workflow filename: `release.yml`
   - Environment: leave empty
3. Save. The entry appears in the list immediately.

Until this exists, a tag push fails at the publish step with an authentication
error; nothing else in the workflow is affected.

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
