# tts-explain-demo

GitHub Pages demo for TTS-Explain with a 4-step flow:

1. Select model
2. Select explanation type
3. Select target (for Global)
4. Explore interactive atlas/global view

## Local preview

From this repo root:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Data files used

The demo expects model-specific data in-repo:

- `assets/data/clip/atlas/concept_atlas_clip_qwen_gpus_4567.atlas.gz`
- `assets/data/densenet161/atlas/concept_atlas_densenet161_qwen_gpus_4567.atlas.gz`
- `assets/data/resnet18/atlas/concept_atlas_resnet18_qwen_gpus_4567.atlas.gz`
- `assets/data/{model}/global/targets.json` (Global target manifest)
- `assets/data/{model}/global/{target_slug}/*.gexp.gz` (+ optional `.preview.txt` and preview image)

To regenerate from source atlases:

```bash
gzip -c /mnt/nfsshare/home/bykov1/tts_explain/runs/clip/openimages/explainer/concept_atlas_qwen_gpus_4567.atlas \
  > assets/data/clip/atlas/concept_atlas_clip_qwen_gpus_4567.atlas.gz

gzip -c /mnt/nfsshare/home/bykov1/tts_explain/runs/densenet/explainer_places365_densenet161/concept_atlas_qwen_gpus_4567.atlas \
  > assets/data/densenet161/atlas/concept_atlas_densenet161_qwen_gpus_4567.atlas.gz

gzip -c /mnt/nfsshare/home/bykov1/tts_explain/runs/resnet/concept_atlas_qwen_gpus_4567.atlas \
  > assets/data/resnet18/atlas/concept_atlas_resnet18_qwen_gpus_4567.atlas.gz
```

## Publish on GitHub Pages

1. Push this repository to GitHub.
2. In repo settings, enable Pages from `main` branch root.
3. Wait for deployment and open the Pages URL.

No build step is required.

## Browser note

The demo loads `.atlas.gz` in-browser and decompresses it with `DecompressionStream`.
Use a modern browser (recent Chrome/Edge/Firefox).
