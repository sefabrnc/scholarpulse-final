# Colab Citation Pipeline

> **Türkçe kurulum rehberi (Colab + Cloudflare + CE):** [`docs/KURULUM_REHBERI_COLAB_CF.md`](../../docs/KURULUM_REHBERI_COLAB_CF.md)

This package provides a runnable 8-pass Colab ingestion backbone wired to
`POST /api/cite/bulk-ingest`, including:

- pass0 text extraction with union bbox + math/code skip
- pass0.5 GROBID TEI reference parse with **hybrid routing** (`SP_GROBID_MODE=auto`: clean PDF → GROBID, dirty → regex)
- pass1 real embedding inference (Qwen3-Embedding-0.6B or BGE-M3) with stub fallback
- pass2 OpenAlex resolve + strict DOI canonicalization + alias collection
- pass3 FAISS/local index candidate search with pending_bibs queue
- pass4 cross-encoder rerank (gte-reranker-modernbert or Qwen3-Reranker) + confidence tier
- pass5 CiteFusion SciCite WS intent (6-label contract) with SciCite/rule stub fallback
- pass6 marker post-validation (enum false-positive filter)
- pass7 serializer + meta.doi_aliases + model_backends metadata
- `colab/scripts/run_and_ingest.py` example ingest script

## Folder Layout

- `config.py`: environment-driven thresholds, model names, service URLs.
- `main.py`: CLI runner that executes pass0..pass7 in sequence.
- `smoke_test.py`: stub-path smoke tests (no GPU/models required).
- `post_bulk_ingest.py`: helper script to POST generated payload to API.
- `stages/`: pass modules (pass0 through pass7).
- `models/`: embedding, reranker, intent loaders with deterministic fallback.
- `clients/`: GROBID/OpenAlex/canonical DOI resolver helpers.
- `policies/skip_policies.py`: OCR skip and math/code skip helpers.
- `serializers/bulk_ingest.py`: chunk-safe payload serializer.

## Requirements

Python 3.11+ recommended. Colab Free T4 (16 GB) is the primary target.

```bash
pip install requests pymupdf faiss-cpu
pip install torch --index-url https://download.pytorch.org/whl/cu118
pip install sentence-transformers transformers
```

Optional (GROBID server, not required for stub/fallback path):

```bash
docker run -p 8070:8070 lfoppiano/grobid:0.8.0
```

## GPU Check (Colab)

Run in a notebook cell before pipeline execution:

```python
import torch
print("cuda:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device:", torch.cuda.get_device_name(0))
    print("mem_gb:", round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1))
```

Expected on Colab Free: `cuda: True`, device `Tesla T4`, ~15 GB.

Force stub mode (no model download):

```bash
set SP_USE_REAL_MODELS=0
```

## Environment Variables

Defaults are in `config.py`; override as needed:

```bash
set SP_USE_REAL_MODELS=1
set SP_EMBED_MODEL=Qwen/Qwen3-Embedding-0.6B
set SP_RERANK_MODEL=Alibaba-NLP/gte-reranker-modernbert-base
set SP_INTENT_MODEL=citefusion/scicite-ws
set SP_CITEFUSION_WEIGHTS_DIR=/content/drive/MyDrive/citefusion/scicite-ws
set SP_CE_THRESHOLD=0.85
set SP_HIGH_CONFIDENCE_THRESHOLD=0.95
set SP_VECTOR_SCORE_THRESHOLD=0.50
set SP_BIB_MATCH_THRESHOLD=0.92
set SP_OPENALEX_BASE_URL=https://api.openalex.org
set SP_GROBID_BASE_URL=http://localhost:8070
set SP_GROBID_MODE=auto
set SP_CHECKPOINT_DIR=/content/drive/MyDrive/scholarpulse/checkpoints/run-001
set SP_CHECKPOINT_EVERY=25
set SP_RESUME_CHECKPOINT=%SP_CHECKPOINT_DIR%/stage.sqlite
set SP_INGEST_API_URL=http://localhost:8787/api/cite/bulk-ingest
set SP_INGEST_TOKEN=your_token
```

Model fallback chain (automatic when primary fails):

| Role | Primary | Fallback |
|---|---|---|
| Embedding | `Qwen/Qwen3-Embedding-0.6B` | `BAAI/bge-m3` -> deterministic stub |
| Reranker | `Alibaba-NLP/gte-reranker-modernbert-base` | `Qwen/Qwen3-Reranker-0.6B` -> Jaccard stub |
| Intent | `citefusion/scicite-ws` | `lostelf/scibert_scivocab_uncased_scicite_finetuned` (WS proxy) -> rule stub |

CiteFusion has no public HuggingFace repo. Full SciCite WS ensemble weights
(SciBERT + XLNet OVA couples + FFNN meta) ship with the paper web app; place
extracted files under `SP_CITEFUSION_WEIGHTS_DIR/citefusion_scicite_ws/`.
Until then the pipeline uses WS-framed SciCite SciBERT (Macro-F1 ~0.84).

Sources:
- Paper: https://link.springer.com/article/10.1007/s11192-025-05418-8
- arXiv: https://arxiv.org/abs/2407.13329
- Zenodo: https://zenodo.org/records/15011985

VRAM policy: only one heavy model resident per pass (`release()` after pass1/4/5).
See `docs/COLAB_COMPUTE_BUDGET.md` for throughput and 160K timeline.

`algorithm_version` in bulk payload:

- `v1-colab-ml` — all three real backends loaded
- `v1-colab-ml-partial` — mixed real + stub
- `v0-skeleton` — all stubs (local dev / missing deps)

## Run (Step by Step)

1) Prepare minimal metadata file (optional):

```json
{
  "title": "Sample Paper",
  "authors": ["A. Author", "B. Author"],
  "year": 2024,
  "landing_url": "https://doi.org/10.1000/sample",
  "raw_text": "Sample extracted text from PDF..."
}
```

2) Run smoke tests (no GPU):

```bash
python -m colab.pipeline.smoke_test
```

3) Run the CLI:

```bash
python -m colab.pipeline.main --pdf path/to/paper.pdf --doi 10.1000/sample --metadata-json path/to/meta.json --out payload.json
```

4) Inspect generated payload:
- `paper_search`
- `cite_nodes`
- `cite_edges`
- `doi_aliases`
- `meta.algorithm_version`
- `meta.model_backends`

5) Post payload to ingest API:

```bash
python colab/scripts/run_and_ingest.py --pdf path/to/paper.pdf --doi 10.1000/sample --metadata-json path/to/meta.json --out payload.json --ingest --token %SP_INGEST_TOKEN% --verbose
```

6) Batch E2E with Drive checkpoint (Colab/Kaggle):

```bash
python colab/notebooks/ingest_pipeline_runner.py --manifest manifest.json --checkpoint-dir %SP_CHECKPOINT_DIR% --run-id run-001 --out-dir payloads --ingest
```

Production notebook: `colab/notebooks/ingest_pipeline.ipynb`

Or post an existing payload:

```bash
python -m colab.pipeline.post_bulk_ingest --payload payload.json --api-url http://127.0.0.1:8787/api/cite/bulk-ingest --token %SP_INGEST_TOKEN%
```

## Output Shape (example)

```json
{
  "nodes": [],
  "edges": [],
  "vectors": { "sentence": [], "paper": [] },
  "meta": {
    "doi": "10.1000/sample",
    "doi_aliases": {},
    "resolved_references": 0,
    "algorithm_version": "v1-colab-ml",
    "model_backends": {
      "embedding": { "model": "Qwen/Qwen3-Embedding-0.6B", "backend": "sentence-transformers" },
      "reranker": { "model": "Alibaba-NLP/gte-reranker-modernbert-base", "backend": "cross-encoder" },
      "intent": { "model": "citefusion/scicite-ws", "backend": "citefusion-scicite-ws" }
    }
  }
}
```

## Current Scope

Implemented:
- Union-bbox node extraction from PyMuPDF text blocks (`block.type == 0`).
- Figure/table/image candidate extraction via `find_tables`, `cluster_drawings`, and `get_image_info`.
- GROBID TEI parsing into structured references (DOI/arXiv/year/authors/title).
- OpenAlex-based DOI canonicalization with strict match gates and alias map generation.
- Real ML inference on Colab T4 with automatic stub fallback.
- Candidate generation + rerank + intent label contract.
- Bulk payload generation with 50 paper/chunk serializer compatibility.

Still optional / external:
- GROBID Docker runtime (client + TEI parser implemented; server optional)
- CF Queue consumer (Colab polls `/api/internal/ingest-queue` stub)
- cite-quality-eval gate on 200+ real labeled pairs (separate eval workstream)

## Free GPU failover (Colab + Kaggle, $0)

Primary: Google Colab Free T4 (~12h/session, disconnect after idle).
Secondary: Kaggle Notebooks (30 GPU hours/week, T4 x2).

Recommended hybrid flow:

1. Run the same notebook on Colab and keep a Kaggle clone under `colab/notebooks/`.
2. Checkpoint every N papers to Google Drive:
   - `drive/MyDrive/scholarpulse/checkpoints/{run_id}/stage.sqlite`
   - `drive/MyDrive/scholarpulse/checkpoints/{run_id}/cursor.json`
3. On Colab disconnect, resume on Kaggle:
   - Mount Drive, copy checkpoint locally, set `SP_RESUME_CHECKPOINT=/path/to/stage.sqlite`
   - Continue from saved cursor (last processed DOI / chunk id)
4. Nightly heartbeat: `POST /api/internal/heartbeat` every 10 minutes while ingesting.

Minimal checkpoint env vars:

```bash
set SP_CHECKPOINT_DIR=/content/drive/MyDrive/scholarpulse/checkpoints/run-001
set SP_RESUME_CHECKPOINT=%SP_CHECKPOINT_DIR%/stage.sqlite
set SP_CHECKPOINT_EVERY=25
```

Kaggle setup notes:

- Enable GPU: Settings -> Accelerator -> GPU T4 x2
- Add Drive mount cell before pipeline runner
- Respect weekly 30h cap; Colab fills remaining throughput
