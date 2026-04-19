# build-resources

Icônes et assets utilisés par electron-builder pour le packaging.

## Fichiers requis

| Fichier       | Usage              | Taille recommandée |
|---------------|--------------------|--------------------||
| `icon.ico`    | Windows (NSIS)     | 256×256 (multi-size ICO) |
| `icon.icns`   | macOS (DMG)        | 1024×1024 (ICNS bundle)  |
| `icon.png`    | Linux (AppImage/deb) | 512×512 PNG        |

## Génération

À partir d'un PNG source 1024×1024 :

```bash
# macOS : png → icns
iconutil -c icns icon.iconset

# Windows : png → ico  (via ImageMagick)
convert icon.png -resize 256x256 icon.ico

# Linux : déjà un PNG
cp icon_1024.png icon.png
```

Ou utiliser : https://www.electronforge.io/guides/create-and-add-icons
