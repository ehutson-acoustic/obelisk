# Icons

`icon.svg` is the master; everything else in this directory is generated from it
and should never be hand-edited.

The mark is the typographic double obelisk (`‡`) the app is named for, on a
silver plate with the gradient running corner to corner. Two things about the
geometry are deliberate:

* The plate is an 864×864 rounded rect inside a 1024 canvas. That mirrors
  Apple's Big Sur template, which expects the padding to be baked into the
  asset — macOS does not mask app icons. The same padding is harmless on
  Windows and Linux, where Tauri uses the PNG unmasked.
* The lower crossbar is 20% shorter than the upper one. Equal bars read as a
  cross rather than as a printer's mark.

The mark is deliberately *not* redrawn in the app's own UI: in the header it
competed with the editor themes for attention without earning its place.

## Regenerating

Requires a rasterizer, because the Tauri CLI's own SVG handling is not what
produced these files. Any tool that writes a 1024×1024 RGBA PNG will do:

```bash
npx --yes sharp-cli -i icon.svg -o icon-1024.png resize 1024 1024
pnpm tauri icon icon-1024.png -o src-tauri/icons   # from the repo root
rm -rf src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/64x64.png
rm icon-1024.png
```

`tauri icon` also emits iOS, Android, and a 64×64 PNG. Obelisk is a desktop app
(Linux/macOS), so those are deleted rather than committed — hence the third
line.
