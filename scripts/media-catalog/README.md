# Media Catalog Tools

Python utilities for cataloging video collections, extracting metadata patterns, and generating search wishlists.

## Scripts

| Script | Purpose |
|--------|---------|
| `catalog_videos.py` | Scan a directory, parse filenames, extract performer/studio/resolution metadata, write `catalog.json` |
| `rename_videos.py` | Rename files to `Performer - Title (Resolution).mp4` using the catalog |
| `generate_wishlist.py` | Expand performer database and emit `search_wishlist.txt` with ready-to-paste searches |

## Usage

Defaults target `C:\\.000_AI\\.01_Vids`. Pass a directory path to override.

```bash
# 1. Build catalog
python scripts/media-catalog/catalog_videos.py

# 2. Rename files (dry run first)
python scripts/media-catalog/rename_videos.py --dry-run
python scripts/media-catalog/rename_videos.py

# 3. Generate wishlist
python scripts/media-catalog/generate_wishlist.py
```

## Outputs

All outputs are written to the target video directory:

- `catalog.json` — structured metadata for every file
- `search_wishlist.txt` — curated Eporner searches by studio, performer, and genre

## Customization

Edit `catalog_videos.py` and `generate_wishlist.py` to add performers or studios to the lookup tables. Re-run the full pipeline to pick up newly identified names.
