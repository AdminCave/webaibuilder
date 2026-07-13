# App-Icons (electron-builder buildResources)

electron-builder findet hier automatisch:

- `icon.png` — 1024×1024 RGBA, Linux-Quelle (electron-builder leitet die
  weiteren Größen ab)
- `icon.ico` — Windows, 7 Auflösungen (16/24/32/48/64/128/256)
- `icon.icns` — macOS, iconutil-Format (icp4–ic10 + ic11–ic14, PNG-basiert)

## Herkunft

Abgeleitet aus dem AdminCave-Design-System (privates Repo
`AdminCave/DesignSystem`): weiße Marke auf True-Black, Marke bei ~62 % der
Kantenlänge (identische Komposition wie `assets/logo/app/icon-512.png`).
Quelle der Marke: `assets/logo/png/mark-white-1024.png`.

## Neu erzeugen

```bash
# Marke aus dem DesignSystem-Repo holen (gh authentifiziert):
gh api repos/AdminCave/DesignSystem/contents/assets/logo/png/mark-white-1024.png \
  -H "Accept: application/vnd.github.raw" > mark-white-1024.png

# 1024er-Master: Marke auf 634 px, zentriert auf Schwarz
magick -size 1024x1024 xc:black \
  \( mark-white-1024.png -resize 634x634 \) -gravity center -composite \
  -background black -flatten PNG32:icon.png

# Windows-ICO (Multi-Res)
magick icon.png -define icon:auto-resize=256,128,64,48,32,24,16 icon.ico

# macOS-ICNS: Größen erzeugen und als PNG-Container packen
for s in 16 32 64 128 256 512 1024; do magick icon.png -resize ${s}x${s} -strip PNG32:icon_${s}.png; done
# … dann mit dem icns-Packer aus der Projekt-Historie zu icon.icns bündeln
# (icp4=16, icp5=32, icp6=64, ic07=128, ic08=256, ic09=512, ic10=1024,
#  ic11=32, ic12=64, ic13=256, ic14=512).
```
