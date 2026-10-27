#!/usr/bin/env bash
set -euo pipefail

source_font=${1:?"Usage: bash build-bakudai-subset.sh /path/to/Bakudai-Regular.woff2"}
font_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

node "$font_dir/../../../../build/fonts/mahjong-brush-text.js" --write

python3 - "$source_font" "$font_dir" <<'PYFONT'
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

source, font_dir = sys.argv[1], Path(sys.argv[2])
font = TTFont(source)
cmap = font.getBestCmap()
# Alias simplified UI forms missing from the upstream Traditional-Chinese font.
# Keep existing UI strings while drawing their matching brush glyphs.
for character, traditional in {"继": "繼", "续": "續", "厅": "廳", "联": "聯", "赛": "賽", "开": "開"}.items():
    if ord(character) not in cmap and ord(traditional) in cmap:
        for table in font["cmap"].tables:
            if table.isUnicode():
                table.cmap[ord(character)] = cmap[ord(traditional)]
text = (font_dir / "mahjong-brush-text.txt").read_text().strip()
missing = sorted({character for character in text if ord(character) not in font.getBestCmap()})
if missing:
    raise SystemExit("Source font lacks required glyphs: " + "".join(missing))
options = subset.Options()
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
font.flavor = "woff2"
output = font_dir / "bakudai-mahjong.woff2"
font.save(output)
# Check the emitted binary, not just the input text manifest.
emitted = TTFont(output).getBestCmap()
assert all(ord(character) in emitted for character in text)
print(f"Built {len(set(text))} glyphs, {output.stat().st_size} bytes; all requested codepoints verified")
PYFONT
