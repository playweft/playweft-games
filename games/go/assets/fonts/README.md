# Go launch lettering

The launch title and menu use **Ma Shan Zheng** by The Ma Shan Zheng Project
Authors, distributed under SIL Open Font License 1.1. See the
[license](../../../../public/go/ma-shan-zheng-OFL.txt), also copied into the static
build at `go/ma-shan-zheng-OFL.txt`.

- Upstream: https://github.com/googlefonts/mashanzheng
- Source font: https://github.com/google/fonts/blob/main/ofl/mashanzheng/MaShanZheng-Regular.ttf
- Source SHA-256: `6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb`

Only the 33 characters in `menu-text.txt` are included in
`ma-shan-zheng-menu.woff2`. The two title characters are vector outlines in
`../launch-title.svg`. The complete source font is not stored in this repository.
The menu subset includes both difficulty names and transient button labels.
Small resume captions retain the normal interface font.

To regenerate the menu subset with FontTools and Brotli, run from the repository
root with the upstream font downloaded outside the repository:

```sh
pyftsubset /path/to/MaShanZheng-Regular.ttf \
  --text-file=games/go/assets/fonts/menu-text.txt \
  --flavor=woff2 --no-recalc-timestamp \
  --output-file=games/go/assets/fonts/ma-shan-zheng-menu.woff2
```
