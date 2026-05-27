#!/usr/bin/env python3
"""
Generate search wishlists and expand performer detection.
Outputs:
  - search_wishlist.txt (ready-to-paste searches)
  - updates catalog.json with expanded performer database
Usage: python generate_wishlist.py [VIDEO_DIR]
Default VIDEO_DIR: C:\\.000_AI\\.01_Vids
"""

import json
import re
import sys
from pathlib import Path
from collections import Counter

DEFAULT_VIDEO_DIR = r"C:\.000_AI\.01_Vids"

EXPANDED_PERFORMERS = {
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
    'Bella Brewer': ['Bella Brewer'],
    'Codi Vore': ['Codi Vore'],
    'Lana Ivans': ['Lana Ivans'],
    'Katerina Hartlova': ['Katerina Hartlova'],
    'Lucy Li': ['Lucy Li'],
    'Anabelle': ['Anabelle'],
    'Lola Fauve': ['Lola Fauve'],
    'Vivian Blush': ['Vivian Blush'],
    'Samanta Lily': ['Samanta Lily'],
    'Nadine Jansen': ['Nadine Jansen'],
    'Hitomi Tanaka': ['Hitomi Tanaka'],
    'Sha Rizel': ['Sha Rizel'],
    'September Carrino': ['September Carrino'],
    'Tessa Fowler': ['Tessa Fowler'],
    'Leanne Crow': ['Leanne Crow'],
    'Rachel Aldana': ['Rachel Aldana'],
    'Abbi Secraa': ['Abbi Secraa'],
    'Micky Bells': ['Micky Bells'],
    'Dors Feline': ['Dors Feline'],
    'Melissa Manning': ['Melissa Manning'],
    'Maserati': ['Maserati'],
    'Karla James': ['Karla James'],
    'Jennica Lynn': ['Jennica Lynn'],
    'Milly Marks': ['Milly Marks'],
    'Julia Juggs': ['Julia Juggs'],
    'Siri': ['Siri'],
    'Noelle Easton': ['Noelle Easton'],
    'Lily Madison': ['Lily Madison'],
    'Krystal Swift': ['Krystal Swift'],
    'Terry Nova': ['Terry Nova'],
    'Christy Marks': ['Christy Marks'],
    'Angela White': ['Angela White'],
    'Ava Addams': ['Ava Addams'],
    'Sandra Milka': ['Sandra Milka'],
    'Mia Khalifa': ['Mia Khalifa'],
    'Jasmine Black': ['Jasmine Black'],
    'Anastasia Lux': ['Anastasia Lux'],
    'Shione Cooper': ['Shione Cooper'],
    'Sirale': ['Sirale'],
    'Sensual Jane': ['Sensual Jane'],
    'Alison Tyler': ['Alison Tyler'],
    'Penelope Black Diamond': ['Penelope Black Diamond'],
    'Kerry Marie': ['Kerry Marie'],
    'Ines Cudna': ['Ines Cudna'],
    'Bea Flora': ['Bea Flora'],
    'Ewa Sonnet': ['Ewa Sonnet'],
    'Aneta Buena': ['Aneta Buena'],
    'Malene Espensen': ['Malene Espensen'],
    'Denise Davies': ['Denise Davies'],
    'Maria Moore': ['Maria Moore'],
    'Samantha 38G': ['Samantha 38G'],
    'Daphne Rosen': ['Daphne Rosen'],
    'Minka': ['Minka'],
    'Keisha Evans': ['Keisha Evans'],
    'Chelsea Charms': ['Chelsea Charms'],
    'Beshine': ['Beshine'],
    'Busty Dusty': ['Busty Dusty'],
    'Tiffany Towers': ['Tiffany Towers'],
    'Wendy Whoppers': ['Wendy Whoppers'],
    'Lisa Lipps': ['Lisa Lipps'],
    'SaRenna Lee': ['SaRenna Lee'],
    'Traci Topps': ['Traci Topps'],
    'Ebony Ayes': ['Ebony Ayes'],
    'Angelique': ['Angelique'],
    'Chloe Vevrier': ['Chloe Vevrier'],
    'Lorna Morgan': ['Lorna Morgan'],
    'Merilyn Sakova': ['Merilyn Sakova'],
    'Yulia Nova': ['Yulia Nova'],
    'Natalie Fiore': ['Natalie Fiore'],
    'Joanna Bliss': ['Joanna Bliss'],
    'Jenny McClain': ['Jenny McClain'],
    'Erin Star': ['Erin Star'],
    'Helen Star': ['Helen Star'],
    'Alexya': ['Alexya'],
    'Demmy Blaze': ['Demmy Blaze'],
    'Dolly Fox': ['Dolly Fox'],
    'Roxi Red': ['Roxi Red'],
    'Vanessa Y': ['Vanessa Y'],
    'Shauna Grant': ['Shauna Grant'],
    'Debbie Jordan': ['Debbie Jordan'],
    'Laura Orsolya': ['Laura Orsolya'],
    'Emma Butt': ['Emma Butt'],
    'Paige Turnah': ['Paige Turnah'],
    'Kelly Madison': ['Kelly Madison'],
    'Amber Alena': ['Amber Alena'],
    'Annabelle Rogers': ['Annabelle Rogers'],
    'Crystal Swift': ['Crystal Swift'],
    'Dominno': ['Dominno'],
    'Donna Bell': ['Donna Bell'],
    'Emma Leigh': ['Emma Leigh'],
    'Holly Garner': ['Holly Garner'],
    'Josephine Jackson': ['Josephine Jackson'],
    'Lauren Phillips': ['Lauren Phillips'],
    'Marina Visconti': ['Marina Visconti'],
    'Nekane': ['Nekane'],
    'Peta Jensen': ['Peta Jensen'],
    'Sheridan Love': ['Sheridan Love'],
    'Stacy Vandenberg': ['Stacy Vandenberg'],
    'Tigerr Benson': ['Tigerr Benson'],
    'Vicky Soleil': ['Vicky Soleil'],
    'Wendy Star': ['Wendy Star'],
    'Xenia Wood': ['Xenia Wood'],
    'Zena': ['Zena'],
}

def generate_wishlist():
    lines = []
    lines.append("=" * 70)
    lines.append("EPORNER SEARCH WISHLIST")
    lines.append("Copy/paste any line into the Eporner search bar.")
    lines.append("Add '2160p' or '4K' to the end for high-res filtering.")
    lines.append("=" * 70)
    lines.append("")
    
    lines.append("--- BY STUDIO/SERIES (proven sources) ---")
    studios = [
        ("Prime Cups 2160p", "PerfectGonzo natural busty, multiple 4K scenes"),
        ("Hqcollect 2160p", "Curated Euro 4K uploads — follow this uploader"),
        ("IntimatePOV 2160p", "POV with busty/natural performers"),
        ("FKG 2160p", "Euro casting series in 4K"),
        ("VLF 2160p", "Euro casting/anal 4K"),
        ("Scoreland 2160p", "Large natural specialist"),
        ("Bella Brewer 2160p", "Natural busty British performer"),
        ("LegalPorno 2160p", "Euro gangbang/DP/anal in 4K"),
        ("Woodman Casting 2160p", "Euro natural casting 4K"),
        ("DDF Busty 2160p", "Busty-focused scenes, filter for natural"),
        ("PinupFiles 2160p", "Natural busty softcore"),
        ("XL Girls 2160p", "Plus-size natural busty"),
    ]
    for search, note in studios:
        lines.append(f"{search:<40} # {note}")
    lines.append("")
    
    lines.append("--- BY PERFORMER (expand favorites) ---")
    performers = [
        "Jessa Rhodes 2160p", "Skylar Vox 2160p", "Gianna Dior 2160p",
        "Brooklyn Blue 2160p", "Kylie Page 2160p", "Kyra Queen 2160p",
        "Lolly Gartner 2160p", "Angela White 2160p", "Ava Addams 2160p",
        "Siri 2160p", "Noelle Easton 2160p", "Katerina Hartlova 2160p",
        "Sensual Jane 2160p", "Shione Cooper 2160p", "Anastasia Lux 2160p",
        "Tigerr Benson 2160p", "Marina Visconti 2160p", "Josephine Jackson 2160p",
        "Emma Leigh 2160p", "Nekane 2160p", "Stacy Vandenberg 2160p",
    ]
    for p in performers:
        lines.append(p)
    lines.append("")
    
    lines.append("--- BY GENRE + NATURAL BUSTY + 4K ---")
    genres = [
        ("natural busty milf 2160p", "MILF + natural + 4K"),
        ("natural tits pov 2160p", "POV with natural performers"),
        ("saggy tits 2160p", "Direct aesthetic match"),
        ("hanging tits 2160p", "Direct aesthetic match"),
        ("mature busty 2160p", "Older natural performers"),
        ("chubby busty 2160p", "Plus-size natural"),
        ("bbw busty 2160p", "BBW natural 4K"),
        ("euro busty casting 2160p", "Euro + casting + busty + 4K"),
        ("all natural busty 2160p", "Explicit natural filter"),
        ("big naturals 2160p", "Brazzers sub-label, some good scenes"),
    ]
    for search, note in genres:
        lines.append(f"{search:<40} # {note}")
    lines.append("")
    
    lines.append("--- Uploader Trace Instructions ---")
    lines.append("1. Go to eporner.com")
    lines.append("2. Search for one of your existing Hqcollect IDs")
    lines.append("3. Click the video result")
    lines.append("4. Click the uploader's name/profile")
    lines.append("5. Filter their uploads by 2160p/4K")
    lines.append("")
    lines.append("=" * 70)
    return "\n".join(lines)

def main():
    video_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_VIDEO_DIR)
    wishlist_path = video_dir / "search_wishlist.txt"
    catalog_file = video_dir / "catalog.json"
    
    wishlist = generate_wishlist()
    with open(wishlist_path, 'w', encoding='utf-8') as f:
        f.write(wishlist)
    print(f"Saved: {wishlist_path}")
    
    if catalog_file.exists():
        with open(catalog_file, 'r', encoding='utf-8') as f:
            catalog = json.load(f)
        
        for entry in catalog.get('entries', []):
            filename = entry['filename']
            found = []
            for performer, aliases in EXPANDED_PERFORMERS.items():
                for alias in aliases:
                    if re.search(re.escape(alias), filename, re.IGNORECASE):
                        found.append(performer)
                        break
            entry['performers'] = list(dict.fromkeys(found))
        
        catalog['by_performer'] = dict(Counter(
            p for e in catalog['entries'] for p in e['performers']
        ).most_common())
        catalog['performers_with_multiple'] = [
            f"{p}: {c} scenes" for p, c in Counter(
                p for e in catalog['entries'] for p in e['performers']
            ).most_common() if c >= 2
        ]
        
        with open(catalog_file, 'w', encoding='utf-8') as f:
            json.dump(catalog, f, indent=2, ensure_ascii=False)
        print(f"Updated: {catalog_file} with {len(EXPANDED_PERFORMERS)} known performers")
    else:
        print("No catalog.json found to update. Run catalog_videos.py first.")
    
    print("\nDone.")

if __name__ == '__main__':
    main()
