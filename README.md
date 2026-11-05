# Skarv

Splice two or more FL Studio projects (`.flp`) into one, on a timeline. Runs entirely in the browser.

**Use it online: [skarv.kan3da.com](https://skarv.kan3da.com)**

Open `skarv.html` in a browser, drop in your projects, arrange them on the timeline and download the result.

## What it does

- The top project is the **base**: its master, mixer layout and project settings are kept. The other projects' masters are skipped.
- Channels, patterns (including empty, clip-only patterns), playlist clips, time markers and automation links from the other projects are renumbered and added.
- Mixer inserts in use are appended after the base's, with effects, sends and parameters. In FL 2025+ the mixer grows as needed.
- Options: separate or shared playlist tracks, one Channel rack group per project (numbered in timeline order), one mixer track color per project (matching the timeline), project name and original insert number on unnamed mixer tracks, a time marker per project (optionally a Marker loop, so FL repeats each project until you jump to another), and a tempo automation clip that steps to each project's BPM.

Tested with projects saved in FL Studio 21, 2024, 2025 and 2026. Always keep your originals.

## Files

| File | Purpose |
| --- | --- |
| `skarv.html` | The built, single-file tool. This is the one to open or host. |
| `index.html` | Page source (layout, styles, UI logic). |
| `flpmerge.js` | FLP parser and merge engine. Works in the browser and in Node. |
| `build.js` | Inlines `flpmerge.js` into `index.html` and writes `skarv.html`. |
| `DESIGN.md` | Design direction and themes. |

After editing `index.html` or `flpmerge.js`, rebuild:

```bash
node build.js
```

## FLP format notes

Learned while building this; not officially documented.

- Events: id `< 64` byte, `< 128` word, `< 192` dword, otherwise varint-length data. FL 2026 adds event `172` as an extended-id prefix (`type << 24 | id`).
- Channel → mixer routing: event `22` (byte) up to FL 24, event `104` (word) from FL 2025. Event `132` is a per-channel serial, not the insert.
- Playlist items are 60 bytes (FL 21–24), 80 (FL 2025) or 88 (FL 2026).
- Mixer parameter records (event `225`): insert = `(cd >> 6) - 0x1c0`, slot = `cd & 63`; sends use `u1 = 0x20` with the destination in the id byte.
- An insert's color is event `149` (dword `0x00BBGGRR`), first in its block and only present on colored inserts. FL ignores it unless the insert's event `42` (byte) is `1`.
- An insert's name is event `204` (UTF-16LE, zero-terminated), right before its event `236`.
- A mixer plugin's wrapper data (event `212`) starts with its own insert and slot numbers.
- Automation links (event `227`): channel targets are plain indexes, mixer targets are `0x2000 | insert << 6 | slot`, the master tempo is `0x4000` with parameter `5`.
- Tempo automation values are `(BPM - 60) / 120`; points are position deltas in beats.
