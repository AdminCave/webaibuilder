# App icons (electron-builder buildResources)

electron-builder automatically finds here:

- `icon.png` — 1024×1024 RGBA, Linux source (electron-builder derives the
  other sizes)
- `icon.ico` — Windows, 7 resolutions (16/24/32/48/64/128/256)
- `icon.icns` — macOS, iconutil format (icp4–ic10 + ic11–ic14, PNG-based)

## Origin

Derived from the AdminCave design system (private repo
`AdminCave/DesignSystem`): white mark on true black, mark at ~62% of the
edge length (identical composition to `assets/logo/app/icon-512.png`).
Source of the mark: `assets/logo/png/mark-white-1024.png`.

## Regenerate

```bash
# Fetch the mark from the DesignSystem repo (gh authenticated):
gh api repos/AdminCave/DesignSystem/contents/assets/logo/png/mark-white-1024.png \
  -H "Accept: application/vnd.github.raw" > mark-white-1024.png

# 1024 master: mark at 634 px, centered on black
magick -size 1024x1024 xc:black \
  \( mark-white-1024.png -resize 634x634 \) -gravity center -composite \
  -background black -flatten PNG32:icon.png

# Windows ICO (multi-res)
magick icon.png -define icon:auto-resize=256,128,64,48,32,24,16 icon.ico

# macOS ICNS: generate the sizes and pack them as a PNG container
for s in 16 32 64 128 256 512 1024; do magick icon.png -resize ${s}x${s} -strip PNG32:icon_${s}.png; done
# … then bundle them into icon.icns with the icns packer from the project history
# (icp4=16, icp5=32, icp6=64, ic07=128, ic08=256, ic09=512, ic10=1024,
#  ic11=32, ic12=64, ic13=256, ic14=512).
```
