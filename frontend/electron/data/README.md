# Chinese title snapshot

Source: https://github.com/soruly/anilist-chinese

Downloaded: 2026-09-20. The JSON maps AniList IDs to Chinese titles and synonyms.
Upstream occasionally includes empty titles; these entries are excluded from search.
The upstream MIT license is included in `anilist-chinese.LICENSE`.

This file is a bundled offline fallback. Runtime updates are validated and stored
separately in the user's SQLite database; they never modify the application files.
