# tts-explain-demo

GitHub Pages demo for TTS-Explain with a 3-step flow:

1. Select model
2. Select explanation type
3. Explore interactive atlas

## Local preview

From this repo root:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Data file used

The demo expects:

- `assets/data/concept_atlas_qwen_gpus_4567.atlas.gz`

To regenerate from your source atlas:

```bash
gzip -c /mnt/nfsshare/home/bykov1/tts_explain/runs/clip/openimages/explainer/concept_atlas_qwen_gpus_4567.atlas \
  > assets/data/concept_atlas_qwen_gpus_4567.atlas.gz
```

## Publish on GitHub Pages

1. Push this repository to GitHub.
2. In repo settings, enable Pages from `main` branch root.
3. Wait for deployment and open the Pages URL.

No build step is required.

## Browser note

The demo loads `.atlas.gz` in-browser and decompresses it with `DecompressionStream`.
Use a modern browser (recent Chrome/Edge/Firefox).
