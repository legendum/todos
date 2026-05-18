# `pues/base/auth/` — Legendum auth, vendored

Authentication for pues-consuming Legendum services. Adopted by todos and
fifos as of v0.8.0. The full SPEC lives in `docs/SPEC.md` §3 (extracted
parts) and §9 (vendoring); this README covers only the SDK sync flow
that's specific to this part.

## Files

| | source of truth | how it gets here |
|---|---|---|
| `legendum.js` | `legendum/public/sdk/legendum.js` | `bun run sync-sdk` |
| `legendum.d.ts` | `legendum/public/sdk/legendum.d.ts` | `bun run sync-sdk` |
| `legendum.md` | `legendum/public/sdk/legendum.md` | `bun run sync-sdk` |

The other `.ts`/`.tsx` files in this directory are the pues auth
surface itself, authored here and committed normally.

## Sync flow — one direction, one intermediary

```
legendum repo (canonical) → pues repo (vendored) → consumer repos (vendored)
   public/sdk/                base/auth/           pues/base/auth/
        ↑                          ↑                       ↑
        |                          |                       |
  legendum maintainers      pues sync-sdk             bun run pues
                              (peer-repo)            (existing flow)
```

Consumers **never** sync the SDK directly from legendum. They re-vendor
pues; the SDK arrives bundled inside the `auth` part. This collapses
SDK version drift across the fleet to one point — the SDK version
pues is currently vendoring is the version every consumer sees.

## Running the sync

From `pues/`:

```sh
bun run sync-sdk
```

Reads from `../legendum/public/sdk/` by default (assumes a sibling
checkout). Set `LEGENDUM_SDK_DIR` to override the source path.

Run periodically — typically when legendum publishes a new SDK
version, or when you're about to cut a pues release that's intended to
ship a refreshed SDK to consumers. The script is idempotent; rerunning
without upstream changes is a no-op (same bytes copied).

## After syncing

1. Inspect the diff in `pues/base/auth/legendum.{js,d.ts,md}`.
2. If the SDK API changed in a way that affects `mountLegendum.ts` or
   `Legendum.tsx`, update those.
3. Commit the synced files + any code changes together.
4. The next consumer-side `bun run pues` will pick up the new SDK.
