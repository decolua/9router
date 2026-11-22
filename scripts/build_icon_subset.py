#!/usr/bin/env python3
"""Rebuild public/fonts/material-symbols-subset.woff2 from the icons src/ uses.

Why this exists: material-symbols/material-symbols-outlined.woff2 is 3.96 MB.
The whole UI hides icon glyphs at opacity 0 until the font is ready, so on a slow
deploy target that megabyte is felt as "icons pop in late" or "menu has no icon".
This script keeps only the ligatures src/ actually renders (144 at last run,
~110 KB) and drops it in public/ where it is served as a static asset.

Requires: pip install fonttools brotli   (any machine with the repo checked out)

    python3 scripts/build_icon_subset.py

Writes:
  public/fonts/material-symbols-subset.woff2
  public/fonts/material-symbols-glyphs.txt   (icon names covered; the unit test
                                              fails when src/ grows a new icon)

Notes that cost real debugging time and are recorded here on purpose:
  * icon names are ligatures under GSUB feature **rlig** (not liga), lookup type
    7 (Extension) -> 4 (LigatureSubst), with glyph names coming from cmap PUA
    codepoints. pyftsubset's layout closure over rlig keeps all 4262 ligatures
    and OOMs; selecting by unicodes drops the ligature table. So: subset the
    outlines without layout features, then graft a filtered GSUB on top.
  * a LigatureSubst table must be wrapped in newTable("GSUB") before assigning;
    handing TTFont a bare otTables.GSUB fails at compile() with
    "missing 1 required positional argument: 'font'".
"""
import os
import re
import string
import subprocess
import sys
import tempfile
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
FULL_FONT = os.path.join(ROOT, "node_modules/material-symbols/material-symbols-outlined.woff2")
OUT_WOFF2 = os.path.join(ROOT, "public/fonts/material-symbols-subset.woff2")
OUT_LIST = os.path.join(ROOT, "public/fonts/material-symbols-glyphs.txt")

ICON_PATTERNS = [
    re.compile(r'icon:\s*"([a-z_0-9]+)"'),
    re.compile(r'icon="([a-z_0-9]+)"'),
    re.compile(r'material-symbols-outlined[^>]*>\s*([a-z_0-9]+)\s*<'),
]


def collect_icon_names():
    """Icon-shaped string literals in src/. Noise (state vars, prose) is fine:
    it is filtered out below by the font's own ligature list."""
    names = set()
    for base, _dirs, files in os.walk(SRC):
        for fn in files:
            if not fn.endswith((".js", ".jsx", ".ts", ".tsx", ".json")):
                continue
            try:
                text = open(os.path.join(base, fn), encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            for pat in ICON_PATTERNS:
                names.update(pat.findall(text))
    return names


def load_ligatures(font_path):
    """{icon word: ligature glyph name} from GSUB, unwrapping Extension lookups."""
    from fontTools.ttLib import TTFont

    font = TTFont(font_path)
    cmap = font.getBestCmap()
    ligs = {}

    def walk(st):
        entries = getattr(st, "ligatures", None)
        if entries is not None:
            for first, items in entries.items():
                for entry in items:
                    chars = [first] + list(entry.Component)
                    word = ""
                    for glyph in chars:
                        cps = [cp for cp, gn in cmap.items() if gn == glyph]
                        if not cps:
                            return
                        word += chr(cps[0])
                    ligs[word.lower()] = entry.LigGlyph
        elif hasattr(st, "ExtSubTable"):
            walk(st.ExtSubTable)

    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            walk(sub)
    font.close()
    return ligs


def subset_outlines(codes, tmp):
    """Stage 1: outlines + cmap for the icon PUA codepoints and the a-z0-9_
    letters every ligature is spelled with. No layout features - closure over
    rlig pulls all 4262 ligatures and exhausts memory."""
    out = os.path.join(tmp, "stage1.woff2")
    unicodes = "U+%s,U+61-7A,U+30-39,U+5F" % ",".join(codes)
    subprocess.run(
        [
            sys.executable, "-m", "fontTools.subset", FULL_FONT,
            "--unicodes=" + unicodes, "--layout-features=", "--flavor=woff2",
            "--output-file=" + out, "--no-hinting", "--desubroutinize", "--glyph-names",
        ],
        check=True, timeout=300,
    )
    return out


def graft_gsub(stage1, wanted_ligs, out_path):
    """Stage 2: attach only the ligature entries whose glyphs survived stage 1,
    as a single rlig feature - the feature the original font uses."""
    import json
    from fontTools.ttLib import TTFont, newTable
    from fontTools.ttLib.tables import otTables

    font = TTFont(stage1)
    alive = set(font.getGlyphOrder())
    by_first = defaultdict(list)
    for word, lig_glyph in wanted_ligs.items():
        # resolve the component glyph names against the stage-1 cmap
        cmap = font.getBestCmap()
        glyphs = [cmap.get(ord(ch)) for ch in word.lower()]
        if any(g is None for g in glyphs) or lig_glyph not in alive:
            continue
        if glyphs[0] in alive:
            by_first[glyphs[0]].append((glyphs[1:], lig_glyph))

    gsub = otTables.GSUB()
    gsub.Version = 0x00010000
    script_list = otTables.ScriptList()
    script_list.ScriptRecord = []
    rec = otTables.ScriptRecord()
    rec.ScriptTag = "latn"
    script = otTables.Script()
    script.DefaultLangSys = otTables.LangSys()
    script.DefaultLangSys.ReqFeatureIndex = 0xFFFF
    script.DefaultLangSys.FeatureIndex = [0]
    script.LangSysRecord = []
    rec.Script = script
    script_list.ScriptRecord = [rec]
    gsub.ScriptList = script_list

    feature_list = otTables.FeatureList()
    feature_rec = otTables.FeatureRecord()
    feature_rec.FeatureTag = "rlig"
    feature_rec.Feature = otTables.Feature()
    feature_rec.Feature.LookupListIndex = [0]
    feature_rec.Feature.LookupCount = 1
    feature_list.FeatureRecord = [feature_rec]
    gsub.FeatureList = feature_list

    lookup_list = otTables.LookupList()
    lookup = otTables.Lookup()
    lookup.LookupType = 4
    lookup.LookupFlag = 0
    subst = otTables.LigatureSubst()
    subst.ligatures = {}
    for first, items in sorted(by_first.items()):
        lst = []
        for comps, lig_glyph in items:
            entry = otTables.Ligature()
            entry.Component = comps
            entry.LigGlyph = lig_glyph
            lst.append(entry)
        subst.ligatures[first] = lst
    lookup.SubTable = [subst]
    lookup_list.Lookup = [lookup]
    gsub.LookupList = lookup_list

    table = newTable("GSUB")
    table.table = gsub
    font["GSUB"] = table
    font.flavor = "woff2"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    font.save(out_path)
    return sum(len(v) for v in subst.ligatures.values())


def main():
    if not os.path.exists(FULL_FONT):
        sys.exit("run npm install first: %s not found" % FULL_FONT)

    names = collect_icon_names()
    ligs = load_ligatures(FULL_FONT)
    wanted = {}
    unresolved = []
    for name in sorted(names):
        glyph = ligs.get(name) or ligs.get(name.lower())
        if glyph:
            wanted[name.lower()] = glyph
        else:
            unresolved.append(name)

    if not wanted:
        sys.exit("no icon names matched the font's ligatures - scan patterns need updating")

    # PUA codepoints of the ligature glyphs, used as the stage-1 selection
    from fontTools.ttLib import TTFont

    font = TTFont(FULL_FONT)
    cmap = font.getBestCmap()
    inv = {}
    for cp, glyph in cmap.items():
        inv.setdefault(glyph, cp)
    codes = sorted({inv[g][2:].upper() if isinstance(inv.get(g), str) else format(inv[g], "X")
                    for g in wanted.values() if g in inv})
    font.close()

    tmp = tempfile.mkdtemp(prefix="icon-subset-")
    stage1 = subset_outlines(codes, tmp)
    entries = graft_gsub(stage1, wanted, OUT_WOFF2)

    with open(OUT_LIST, "w", encoding="utf-8") as fh:
        fh.write("\n".join(sorted(wanted)) + "\n")

    size = os.path.getsize(OUT_WOFF2)
    full = os.path.getsize(FULL_FONT)
    print("wrote %s (%d bytes, %d/%d of full font)" % (OUT_WOFF2, size, size, full))
    print("covered icons: %d, ligature entries: %d" % (len(wanted), entries))
    if unresolved:
        print("skipped (not Material Symbols): %s" % ", ".join(unresolved))


if __name__ == "__main__":
    main()
