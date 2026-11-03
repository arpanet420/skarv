# Skarv – designriktning

**Produkt:** lokalt verktyg för att foga ihop FL Studio-projekt. Användaren är producenten själv, vid sin studiodator.

**Huvudsak:** tidslinjen. Projekten ligger som block i var sitt band och dras i sidled. Allt annat (mixerkarta, sammanfattning) är underordnat och ligger under.

**Ton:** mörk studiokonsol – varm grafit, inte blågrå. Kompakt täthet (internt verktyg).

## Typografi (Google Fonts, länkade – fristående sida utan CSP)
- Display: **Bricolage Grotesque** 600–800, tight spärrning – rubriker, stora siffror.
- Text: **Figtree** 400–700 – löptext, etiketter.
- Data: Figtree med `tabular-nums` – takter, insertnummer, BPM, versioner. Inget monospace.
- Mikroetiketter 11px versaler, `.08em`, 700.

## Färg
- Bakgrund `--paper` #15120e (varm grafit), panel #1f1b16, upphöjt #2a251e.
- Bläck `--ink` #efe7da (varm papperston). Kontrast mot bakgrund ≈ 15:1, `--ink-2` #b3a896 ≈ 8:1.
- Accent `--accent` #ff8a3d (mandarin) – bara primär handling och fokus. Mörk text på accent ≈ 8:1.
- Status: varning `--warn` #f0b33c (mörk text ≈ 10:1), fel `--bad` #e5534b (vit text ≈ 4,6:1), ok `--ok` #4fae6a (mörk text).
- Projektfärger (identitet, inte status): teal, violett, ros, himmel, sand, korall – samma ljushet.

## Form
Små element 4px, paneler 14px. Statuschips solida, versaler 10.5px.

## Teman
- `:root` = **Studio** (standard, 2026-11-03).
- `html[data-tema="dagsljus"]` = **Dagsljus**: ljust papper, mörkt bläck, samma accent.
- Väljare uppe till höger, sparas i `localStorage` (`skarv-tema`).
