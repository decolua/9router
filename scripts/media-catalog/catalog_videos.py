#!/usr/bin/env python3
"""
Catalog a video collection and extract metadata patterns.
Usage: python catalog_videos.py [VIDEO_DIR]
Default VIDEO_DIR: C:\\.000_AI\\.01_Vids
Outputs catalog.json in the VIDEO_DIR.
"""

import os
import re
import json
import sys
from pathlib import Path
from collections import Counter

DEFAULT_VIDEO_DIR = r"C:\.000_AI\.01_Vids"

RESOLUTION_PATTERNS = {
    r'\(2160\)': '4K (2160p)',
    r'\(1440\)': '2K (1440p)',
    r'\(1080\)': '1080p',
    r'\(720\)': '720p',
    r'\[4K\]': '4K',
    r'4K': '4K',
    r'{{{\[ 4K \]}}}': '4K',
}

STUDIO_HINTS = {
    'Prime Cups': 'PerfectGonzo / Prime Cups',
    'IntimatePOV': 'IntimatePOV',
    'Hqcollect': 'Hqcollect (Curated Euro)',
    'FKG': 'FKG / Woodman-style',
    'VLF': 'VLF (Euro casting)',
    'Brebis St Albray': 'Euro Casting / Gouda',
    'Just An Affair': 'Feature / Story',
    'Blowbang': 'Blowbang / Group',
    'cumshot compilation': 'Compilation',
    'Cumshot Compilation': 'Compilation',
    'Cum Compilation': 'Compilation',
    'facial compilation': 'Compilation',
    'Double Facial': 'Compilation',
    'Manojob': 'Manojob / Handjob',
    'TAP': 'LegalPorno / TAP',
    'Gangbang': 'Gangbang / Group',
    'DP': 'DP / Anal',
    'SmokinHotMILF': 'MILF / Mature',
    'My Sexy Stepmom': 'Taboo / Step',
    'pool boy': 'Feature / Story',
}

KNOWN_PERFORMERS = {
    'Skylar Vox': ['Skylar Vox'],
    'Kylie Page': ['Kylie Page'],
    'Gianna Dior': ['Gianna Dior'],
    'Jessa Rhodes': ['Jessa Rhodes'],
    'Brooklyn Blue': ['Brooklyn Blue'],
    'Kyra Queen': ['Kyra Queen'],
    'Lolly Gartner': ['Lolly Gartner'],
    'Cassidy Luxe': ['CassidyLuxe'],
    'Lola Bredly': ['Lola Bredly'],
    'Cas Summer': ['Cas Summer'],
    'Luke Cooper': ['Luke Cooper'],
}

def extract_resolution(filename):
    for pattern, label in RESOLUTION_PATTERNS.items():
        if re.search(pattern, filename, re.IGNORECASE):
            return label
    return 'Unknown'

def extract_studio(filename):
    found = []
    for hint, studio in STUDIO_HINTS.items():
        if re.search(re.escape(hint), filename, re.IGNORECASE):
            found.append(studio)
    return list(dict.fromkeys(found))

def extract_performer(filename):
    found = []
    for performer, aliases in KNOWN_PERFORMERS.items():
        for alias in aliases:
            if re.search(re.escape(alias), filename, re.IGNORECASE):
                found.append(performer)
                break
    return list(dict.fromkeys(found))

def extract_eporner_id(filename):
    m = re.search(r'\[([A-Za-z0-9]{10,12})\]', filename)
    return m.group(1) if m else None

def parse_title(filename):
    clean = re.sub(r'EPORNER\.COM - \[[^\]]+\]', '', filename)
    clean = re.sub(r'\(\d+\)', '', clean)
    clean = re.sub(r'\[4K\]|{{{\[ 4K \]}}}', '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\.(mp4|avi|mkv)$', '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'HQ4K\s*-\s*', '', clean, flags=re.IGNORECASE)
    clean = clean.strip(' -')
    return clean

def main():
    video_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_VIDEO_DIR)
    if not video_dir.exists():
        print(f"Directory not found: {video_dir}")
        return

    output_file = video_dir / "catalog.json"
    entries = []
    for f in video_dir.glob('*.mp4'):
        filename = f.name
        size_gb = round(f.stat().st_size / (1024**3), 2)
        
        entry = {
            'filename': filename,
            'title': parse_title(filename),
            'eporner_id': extract_eporner_id(filename),
            'resolution': extract_resolution(filename),
            'size_gb': size_gb,
            'performers': extract_performer(filename),
            'studios': extract_studio(filename),
            'genres': [],
        }
        entries.append(entry)

    stats = {
        'total_files': len(entries),
        'total_size_gb': round(sum(e['size_gb'] for e in entries), 2),
        'by_resolution': Counter(e['resolution'] for e in entries),
        'by_performer': Counter(p for e in entries for p in e['performers']),
        'by_studio': Counter(s for e in entries for s in e['studios']),
        'performers_with_multiple': [],
        'eporner_ids': [e['eporner_id'] for e in entries if e['eporner_id']],
        'entries': entries,
    }
    
    for perf, count in stats['by_performer'].most_common():
        if count >= 2:
            stats['performers_with_multiple'].append(f"{perf}: {count} scenes")

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
    
    print("=" * 60)
    print("VIDEO COLLECTION CATALOG")
    print("=" * 60)
    print(f"\nTotal files: {stats['total_files']}")
    print(f"Total size: {stats['total_size_gb']} GB")
    print(f"\n{'-' * 40}")
    print("BY RESOLUTION")
    print("-" * 40)
    for res, count in stats['by_resolution'].most_common():
        print(f"  {res}: {count} files")
    
    print(f"\n{'-' * 40}")
    print("REPEAT PERFORMERS")
    print("-" * 40)
    if stats['performers_with_multiple']:
        for p in stats['performers_with_multiple']:
            print(f"  * {p}")
    else:
        print("  (No repeat performers detected)")
    
    print(f"\n{'-' * 40}")
    print("STUDIO / STYLE BREAKDOWN")
    print("-" * 40)
    for studio, count in stats['by_studio'].most_common():
        print(f"  * {studio}: {count} files")
    
    print(f"\n{'-' * 40}")
    print("EPORNER IDs")
    print("-" * 40)
    for e in entries:
        if e['eporner_id']:
            res = e['resolution']
            print(f"  [{e['eporner_id']}] {e['title'][:50]}... ({res})")
    
    print(f"\n{'=' * 60}")
    print(f"Full catalog saved to: {output_file}")
    print("=" * 60)

if __name__ == '__main__':
    main()
