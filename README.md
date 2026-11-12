# Mein erstes Spiel

Eine prozedural erzeugte, moderne 3D-Open-World im Browser (Siedlungen mit Strassen, Ampeln, Autos, Windrädern) – gebaut mit [three.js](https://threejs.org) und **WebGPU** (Fallback WebGL2).

**Spielen:** https://drno14.github.io/mein-erstes-spiel/ · **Bewegungs-Editor:** https://drno14.github.io/mein-erstes-spiel/editor.html

## Steuerung

| Taste | Aktion |
|---|---|
| Maus | lenken (ins Bild klicken) |
| W / Shift+W | gehen / sprinten |
| Leertaste | springen |
| E | Fahrzeug / Pferd ein- und aussteigen (W/S, A/D) |
| F · 1–9 / Q · R · G | aufheben · Fach wählen · benutzen/schlagen · ablegen |
| C | Herstellen (Crafting) |
| H | Handeln am Marktstand / eigener Verkaufsstand |
| H (an der Tür) | Spital (Behandlung) · Polizei (stellen) · Bank (Konto, Überfall) · Feuerwehr |
| R mit Pistole | schiessen (braucht Munition, Händler) · Fackel zündet Holz/Büsche an |
| N · T | Wetter wechseln · +2 Stunden |
| K | Skelett-Ansicht |

Andere Welt: `?seed=42` an die Adresse anhängen.

## Lokal starten

```bash
npm install
npm run dev
```

Der Bewegungs-Editor speichert nur lokal (`npm run dev`) in `public/figur-settings.json`.

## Lizenzen

Alle 3D-Modelle sind CC0 – Details in [`public/models/LIZENZEN.txt`](public/models/LIZENZEN.txt)
(Quaternius, Kenney, MakeHuman/MPFB; Bewegungen: CMU Graphics Lab Motion Capture Database).
