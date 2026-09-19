# Chinese title snapshot

Source: https://github.com/soruly/anilist-chinese

Downloaded: 2026-09-20. The JSON maps AniList IDs to Chinese titles and synonyms.
Upstream occasionally includes empty titles; these entries are excluded from search.
The upstream MIT license is included in `anilist-chinese.LICENSE`.

This file is a bundled offline fallback. Runtime updates are validated and stored
separately in the user's SQLite database; they never modify the application files.

`bangumi-data-names.json` supplements simplified Chinese translations using explicit
AniList links from https://github.com/bangumi-data/bangumi-data (CC BY 4.0).
See `bangumi-data.NOTICE` for attribution and the transformation description.
`bangumi-data-names.cjs` extracts runtime source updates into the bundled derivative's
ID/title/aliases model. Names from both sources are merged by AniList ID,
with the supplement's Chinese display title preferred. No fuzzy cross-site matching
or Bangumi API calls are involved.
