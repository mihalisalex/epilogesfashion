# JPEG → WebP migration, 6 September 2026

Rollback material for `PERF-003`. Kept in the repo because without it, undoing this means a
database restore; with it, it is one scripted pass.

## What happened

309 of the catalogue's 311 stored JPEGs were re-encoded to WebP (quality 85, **no resizing** —
a pure format change) and uploaded alongside the originals. The 315 database references were
then rewritten in a single transaction.

| | |
| --- | ---: |
| Converted | 309 |
| Kept as JPEG by the size guard | 2 |
| Failed | 0 |
| Bytes | 32.39 MB → 15.61 MB |
| Saved | **16.77 MB (52%)** |

Quality was measured, not assumed: PSNR 42.7–48.9 dB against the originals' own decoded pixels,
above the ~40 dB at which photographic differences stop being visible.

**The originals were not deleted.** Every `.jpg` referenced before this migration is still in the
Blob store, which is what makes the rollback below safe and instant.

## Files

| File | What it is |
| --- | --- |
| `migration-map.json` | `converted` maps each original JPEG URL → its new WebP URL. Also records `skipped` (with the reason) and `failed`. This is the reverse mapping. |
| `backup-before-webp.json` | Raw contents of `products.images`, `categories.image` and `collections.image` as they were immediately before the write. The belt to the map's braces. |
| `update-db.mjs` | The script that did the rewrite, and the one that undoes it. |

## To roll back

Run from a directory with `DATABASE_URL` in `.env` and `pg` available, with both JSON files
alongside the script:

```bash
node update-db.mjs --rollback            # dry run, prints what it would change
node update-db.mjs --rollback --apply     # writes, in one transaction
```

This repoints every reference back to its original `.jpg`. Those files still exist, so the shop
is correct the moment the transaction commits — no deploy and no cache purge required, though
CDN-cached HTML will keep serving WebP URLs until it revalidates, which is harmless because
those files also still exist.

`backup-before-webp.json` is the fallback if the map is ever lost or partially applied: it holds
the exact prior value of all three columns, keyed by row id.

## The two images that were not converted

Both are larger than the catalogue norm (1200×1598 and 934×1400 against 1000×1333) and resist
WebP — one of them would have grown, 416 KB → 418 KB. The guard refused any file that did not
come out at least 10% smaller. They resist it at q70 too, where the saving would start costing
visible quality on a photograph that *is* the product, so they were left as JPEG deliberately
rather than forced.
