# ScholarPulse — Colab CE + Cloudflare Kurulum Rehberi

> **Kapsam:** Google Colab Free (T4 GPU) üzerinde Cross-Encoder (CE) citation pipeline + Cloudflare Worker/Pages production altyapısı.  
> **Repo kökü:** `scholarpulse-final/`  
> **Son güncelleme:** 2026-05-25

İlgili dokümanlar:

| Doküman | Açıklama |
|---------|----------|
| [`README.md`](../README.md) | Monorepo komutları, QC, env özeti |
| [`apps/api/README.md`](../apps/api/README.md) | Worker endpoint referansı |
| [`apps/web/README.md`](../apps/web/README.md) | Web shell, auth, route haritası |
| [`colab/pipeline/README.md`](../colab/pipeline/README.md) | 8-pass pipeline detayları |
| [`docs/COLAB_COMPUTE_BUDGET.md`](./COLAB_COMPUTE_BUDGET.md) | VRAM/timing bütçesi |
| [`docs/quality-gates.md`](./quality-gates.md) | Eval gate komutları |
| [`BACKEND_LIMITS.md`](../BACKEND_LIMITS.md) | D1 chunking, Vectorize-first sırası |

---

## Önkoşullar

| Araç | Minimum sürüm | Not |
|------|---------------|-----|
| Node.js | 20+ | Worker + web build |
| pnpm (corepack) | 9.12.3 | `packageManager` alanı repo kökünde sabit |
| Wrangler | 4.17+ | `apps/api` devDependency |
| Python | 3.11+ | Colab pipeline |
| Cloudflare hesabı | — | D1, Vectorize, Workers, Pages |
| Google Colab | Free T4 | Birincil GPU; Kaggle yedek |

Repo klonlama:

```bash
git clone https://github.com/YOUR_ORG/scholarpulse-final.git
cd scholarpulse-final
corepack enable
corepack pnpm install
```

---

# Bölüm 1: Cloudflare Hesap + Altyapı

## 1. Cloudflare hesap oluştur

1. [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) adresinden hesap açın.
2. **Workers & Pages** planını etkinleştirin (Free tier D1/Vectorize limitleri için [`docs/ARGE_RAPORU_2026.md`](./ARGE_RAPORU_2026.md) bölüm 4'e bakın).
3. Account ID'nizi not edin: Dashboard → sağ kenar → **Account ID**.

## 2. Wrangler login / API token

### İnteraktif login (geliştirme makinesi)

```bash
cd scholarpulse-final
corepack pnpm --filter @scholarpulse/api exec wrangler login
corepack pnpm --filter @scholarpulse/api exec wrangler whoami
```

### CI / headless token (opsiyonel)

Dashboard → **My Profile** → **API Tokens** → **Create Token**:

| İzin | Kapsam |
|------|--------|
| Account → Workers Scripts | Edit |
| Account → D1 | Edit |
| Account → Workers R2 Storage | Edit |
| Account → Workers Vectorize | Edit |
| Account → Cloudflare Pages | Edit |

Token'ı ortam değişkenine yazın:

```bash
# Linux/macOS
export CLOUDFLARE_API_TOKEN="your-token-here"

# Windows PowerShell
$env:CLOUDFLARE_API_TOKEN = "your-token-here"
```

## 3. D1 database oluştur + migration apply

### 3a. D1 oluştur

```bash
cd scholarpulse-final/apps/api
corepack pnpm exec wrangler d1 create scholarpulse_d1
```

Çıktıdaki `database_id` değerini kopyalayın (örnek: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).

### 3b. Migration dosyaları

Şema migration'ları `apps/api/migrations/` altında:

```
0001_init.sql
0002_internal_ops.sql
0003_revalidation_and_dlq.sql
0004_feed_and_edge_flags.sql
0005_ingest_tldr.sql
```

### 3c. Local test (opsiyonel)

```bash
cd scholarpulse-final
corepack pnpm --filter @scholarpulse/api exec wrangler d1 migrations apply scholarpulse_d1 --local
```

### 3d. Remote apply (production)

```bash
cd scholarpulse-final
corepack pnpm --filter @scholarpulse/api exec wrangler d1 migrations apply scholarpulse_d1 --remote
```

Doğrulama:

```bash
corepack pnpm --filter @scholarpulse/api exec wrangler d1 migrations list scholarpulse_d1 --remote
```

## 4. Vectorize index oluştur (1024 dim)

Embedding modeli `Qwen3-Embedding-0.6B` / `BGE-M3` **1024 boyut** üretir (`colab/pipeline/models/embedding.py`).

```bash
cd scholarpulse-final/apps/api

# Paper-level vektörler (semantic search)
corepack pnpm exec wrangler vectorize create paper_vectors \
  --dimensions 1024 \
  --metric cosine

# Cümle-level vektörler (candidate search)
corepack pnpm exec wrangler vectorize create sentence_vectors \
  --dimensions 1024 \
  --metric cosine

# Doğrulama
corepack pnpm exec wrangler vectorize list
corepack pnpm exec wrangler vectorize get paper_vectors
corepack pnpm exec wrangler vectorize get sentence_vectors
```

`apps/api/wrangler.toml` binding'leri (zaten tanımlı):

```toml
[[vectorize]]
binding = "PAPER_VECTORS"
index_name = "paper_vectors"

[[vectorize]]
binding = "SENTENCE_VECTORS"
index_name = "sentence_vectors"
```

## 5. R2 bucket (opsiyonel — PDF upload)

Kullanıcı PDF upload kuyruğu için transient storage. Binding yoksa metadata yalnızca D1'e yazılır (`apps/api/README.md` → `POST /api/papers/upload`).

```bash
cd scholarpulse-final/apps/api
corepack pnpm exec wrangler r2 bucket create scholarpulse-uploads
```

`apps/api/wrangler.toml` içinde yorum satırlarını açın:

```toml
[[r2_buckets]]
binding = "UPLOADS_BUCKET"
bucket_name = "scholarpulse-uploads"
```

## 6. Worker secrets: COLAB_INGEST_TOKEN, INTERNAL_API_TOKEN

Güçlü rastgele token üretin (örnek):

```bash
# Linux/macOS
openssl rand -hex 32

# PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Secret'ları Worker'a yazın:

```bash
cd scholarpulse-final/apps/api

corepack pnpm exec wrangler secret put COLAB_INGEST_TOKEN
# Prompt: token değerini yapıştırın

corepack pnpm exec wrangler secret put INTERNAL_API_TOKEN
# Prompt: farklı bir token (internal cron/heartbeat için)
```

| Secret | Kullanım |
|--------|----------|
| `COLAB_INGEST_TOKEN` | `POST /api/cite/bulk-ingest` — header: `Authorization: Bearer …` veya `x-ingest-token` |
| `INTERNAL_API_TOKEN` | `/api/internal/*` rotaları (fallback: `COLAB_INGEST_TOKEN`) |

Local geliştirme için `apps/api/.dev.vars` oluşturun:

```bash
COLAB_INGEST_TOKEN=local-dev-token-replace-me
INTERNAL_API_TOKEN=local-internal-token
```

> `.dev.vars` gitignore'da — commit etmeyin.

## 7. wrangler.toml database_id güncelle

`apps/api/wrangler.toml` dosyasında placeholder'ı gerçek ID ile değiştirin:

```toml
[[d1_databases]]
binding = "DB"
database_name = "scholarpulse_d1"
database_id = "BURAYA_D1_DATABASE_ID_YAPIŞTIRIN"
migrations_dir = "migrations"
```

Deploy öncesi doğrulama:

```bash
cd scholarpulse-final/apps/api
corepack pnpm exec wrangler check
```

## 8. Worker deploy

Repo kökünden:

```bash
cd scholarpulse-final
corepack pnpm --filter @scholarpulse/api exec wrangler deploy
```

Deploy sonrası Worker URL'nizi not edin (örnek: `https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev`).

Smoke test:

```bash
curl -s "https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev/health"
# Beklenen: {"ok":true,...}
```

Vectorize binding kontrolü (internal token gerekir):

```bash
curl -s \
  -H "Authorization: Bearer YOUR_INTERNAL_API_TOKEN" \
  "https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev/api/internal/vectorize-indexes"
```

Canlı log:

```bash
corepack pnpm --filter @scholarpulse/api exec wrangler tail
```

## 9. Pages deploy: apps/web + SCHOLARPULSE_API_BASE_URL

### 9a. Build

```bash
cd scholarpulse-final

# Worker URL'nizi export edin
export SCHOLARPULSE_API_BASE_URL="https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev"

corepack pnpm --filter @scholarpulse/web build
```

> **Windows notu:** `apps/web/scripts/build.mjs` başarısız build'de `.next` temizleyip 3 denemeye kadar otomatik retry yapar (`NEXT_DISABLE_WEBPACK_CACHE=1`).

### 9b. Cloudflare Pages — Dashboard yolu

1. Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** (veya Direct Upload).
2. Build settings:
   - **Root directory:** `apps/web`
   - **Build command:** `corepack pnpm install && corepack pnpm build`
   - **Build output:** `.next` (Next.js framework preset kullanıyorsanız Cloudflare otomatik algılar)
3. **Environment variables** (Production + Preview):

```bash
SCHOLARPULSE_API_BASE_URL=https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev
NEXT_PUBLIC_SITE_URL=https://YOUR_PAGES_DOMAIN.pages.dev
SP_REQUIRE_AUTH=0
```

Opsiyonel Supabase auth için `apps/web/.env.example` dosyasındaki değişkenleri ekleyin.

### 9c. Wrangler CLI yolu (Direct Upload)

```bash
cd scholarpulse-final/apps/web
npx wrangler pages project create scholarpulse-web

# Build sonrası (framework adapter'a göre output dizini değişebilir)
npx wrangler pages deploy .next \
  --project-name scholarpulse-web \
  --branch main
```

Pages ortam değişkenlerini dashboard'dan `SCHOLARPULSE_API_BASE_URL` ile ayarlayın; aksi halde web API route'ları in-memory stub'a düşer.

---

# Bölüm 2: Colab Free Kurulum

## 1. Google Colab notebook aç

Production notebook: [`colab/notebooks/ingest_pipeline.ipynb`](../colab/notebooks/ingest_pipeline.ipynb)

Alternatif: Colab'da **File → Upload notebook** ile yükleyin veya repo'yu clone edin:

```python
!git clone -q https://github.com/YOUR_ORG/scholarpulse-final.git /content/scholarpulse-final
%cd /content/scholarpulse-final
```

## 2. GPU T4 seç

Colab menü: **Runtime → Change runtime type**

| Ayar | Değer |
|------|-------|
| Hardware accelerator | **T4 GPU** |
| Runtime shape | Standard (Free) |

GPU doğrulama hücresi:

```python
import torch
print("cuda:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device:", torch.cuda.get_device_name(0))
    print("mem_gb:", round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1))
# Beklenen: cuda: True, device: Tesla T4, mem_gb: ~15
```

## 3. pip install dependencies

```bash
pip install requests pymupdf faiss-cpu
pip install torch --index-url https://download.pytorch.org/whl/cu118
pip install sentence-transformers transformers
```

Stub mod (model indirmeden test):

```bash
export SP_USE_REAL_MODELS=0
python -m colab.pipeline.smoke_test
```

## 4. GROBID Docker (opsiyonel)

Temiz PDF'ler için bibliyografya ayrıştırma kalitesini artırır. Colab'da Docker desteği sınırlı olabilir; local makinede:

```bash
docker run -d --rm -p 8070:8070 --name grobid lfoppiano/grobid:0.8.0
```

Colab'da (destekleniyorsa):

```python
!docker pull -q lfoppiano/grobid:0.8.0
!docker run -d --rm -p 8070:8070 --name grobid lfoppiano/grobid:0.8.0
```

Hybrid routing: `SP_GROBID_MODE=auto` — temiz PDF → GROBID, kirli → regex fallback.

## 5. Env vars

Colab hücresinde (Worker URL'nizi yazın):

```python
import os

os.environ.update({
    # Ingest auth
    "SP_INGEST_TOKEN": "YOUR_COLAB_INGEST_TOKEN",
    "SP_INGEST_API_URL": "https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev/api/cite/bulk-ingest",

    # ML stack
    "SP_USE_REAL_MODELS": "1",
    "SP_EMBED_MODEL": "Qwen/Qwen3-Embedding-0.6B",
    "SP_RERANK_MODEL": "Alibaba-NLP/gte-reranker-modernbert-base",
    "SP_INTENT_MODEL": "citefusion/scicite-ws",

    # CE eşikleri (Bölüm 3)
    "SP_CE_THRESHOLD": "0.85",
    "SP_HIGH_CONFIDENCE_THRESHOLD": "0.95",
    "SP_VECTOR_SCORE_THRESHOLD": "0.50",

    # GROBID
    "SP_GROBID_MODE": "auto",
    "SP_GROBID_BASE_URL": "http://localhost:8070",

    # Checkpoint (Drive)
    "SP_CHECKPOINT_DIR": "/content/drive/MyDrive/scholarpulse/checkpoints/run-001",
    "SP_CHECKPOINT_EVERY": "25",
    "SP_COMPUTE_PLATFORM": "colab",

    # Heartbeat (opsiyonel)
    "SP_HEARTBEAT_URL": "https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev/api/internal/heartbeat",
})
```

> **Not:** Repo'da ingest URL env adı `SP_INGEST_API_URL`'dir (`colab/pipeline/config.py`). Bazı notlarda `SP_API_BASE_URL` geçer; Worker kök URL'si için web tarafında `SCHOLARPULSE_API_BASE_URL` kullanılır.

## 6. CiteFusion weights (opsiyonel Zenodo) veya SciCite HF proxy

CiteFusion tam ensemble weights public HuggingFace'de yok. Seçenekler:

### A) SciCite HF proxy (varsayılan, ek indirme gerekmez)

Pipeline otomatik olarak `lostelf/scibert_scivocab_uncased_scicite_finetuned` kullanır.

### B) Zenodo'dan tam CiteFusion weights

1. [Zenodo record 15011985](https://zenodo.org/records/15011985) indirin.
2. Drive'a çıkarın:

```text
/content/drive/MyDrive/citefusion/scicite-ws/citefusion_scicite_ws/
```

3. Env:

```python
os.environ["SP_CITEFUSION_WEIGHTS_DIR"] = "/content/drive/MyDrive/citefusion/scicite-ws"
```

Kaynaklar: [CiteFusion paper](https://link.springer.com/article/10.1007/s11192-025-05418-8) | [arXiv:2407.13329](https://arxiv.org/abs/2407.13329)

## 7. Tek paper test: run_and_ingest.py

Örnek PDF + DOI ile tam 8-pass pipeline:

```bash
cd /content/scholarpulse-final

python colab/scripts/run_and_ingest.py \
  --pdf /content/sample.pdf \
  --doi 10.48550/arXiv.1706.03762 \
  --out /tmp/payload.json \
  --ingest \
  --token "$SP_INGEST_TOKEN" \
  --verbose
```

Başarı kriterleri (stdout):

```json
{
  "doi": "10.48550/arXiv.1706.03762",
  "algorithm_version": "v1-colab-ml",
  "resolved_references": 28,
  "nodes": 55,
  "edges": 22
}
```

`model_backends.reranker.backend` değeri `cross-encoder` olmalı (stub değil).

Dry-run (POST yapmadan):

```bash
python colab/scripts/run_and_ingest.py \
  --pdf /content/sample.pdf \
  --doi 10.48550/arXiv.1706.03762 \
  --out /tmp/payload.json \
  --use-real-models 1
```

## 8. Batch manifest + checkpoint

### Manifest formatı

`manifest.json` — JSON array:

```json
[
  {
    "pdf": "/content/drive/MyDrive/papers/paper1.pdf",
    "doi": "10.48550/arXiv.1706.03762",
    "metadata_json": "/content/drive/MyDrive/papers/paper1_meta.json"
  },
  {
    "pdf": "/content/drive/MyDrive/papers/paper2.pdf",
    "doi": "10.1038/nature12345"
  }
]
```

### Drive mount + checkpoint

```python
from google.colab import drive
drive.mount('/content/drive')
```

Batch runner:

```bash
python colab/notebooks/ingest_pipeline_runner.py \
  --manifest /content/drive/MyDrive/scholarpulse/manifest.json \
  --checkpoint-dir /content/drive/MyDrive/scholarpulse/checkpoints \
  --run-id run-001 \
  --out-dir /tmp/scholarpulse/payloads \
  --ingest \
  --checkpoint-every 25 \
  --heartbeat-every 600
```

Checkpoint dosyaları:

```text
drive/MyDrive/scholarpulse/checkpoints/run-001/
  stage.sqlite      # işlenen DOI durumları
  cursor.json       # son işlenen DOI + sayaç
```

## 9. Bulk POST /api/cite/bulk-ingest

Pipeline otomatik POST yapar; manuel gönderim:

```bash
python -m colab.pipeline.post_bulk_ingest \
  --payload /tmp/payload.json \
  --api-url "https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev/api/cite/bulk-ingest" \
  --token "$SP_INGEST_TOKEN"
```

curl ile:

```bash
curl -X POST "https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev/api/cite/bulk-ingest" \
  -H "Authorization: Bearer YOUR_COLAB_INGEST_TOKEN" \
  -H "x-ingest-token: YOUR_COLAB_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/payload.json
```

Worker limitleri (`BACKEND_LIMITS.md`):

- Max **50 paper/chunk** (`BULK_INGEST_MAX_PAPERS_PER_CHUNK`)
- Max body **90 MB** (`BULK_INGEST_MAX_BODY_BYTES`)
- Yazım sırası: **Vectorize önce → D1 sonra**

## 10. Kaggle yedek (30h/week)

Colab disconnect olursa aynı notebook'u Kaggle'da çalıştırın:

| Platform | GPU | Haftalık kota |
|----------|-----|---------------|
| Colab Free | T4 x1 | ~12h/session |
| Kaggle | T4 x2 | **30 saat/hafta** |

Kaggle adımları:

1. [kaggle.com/code](https://www.kaggle.com/code) → New Notebook → **Settings → Accelerator → GPU T4 x2**
2. Repo + notebook'u import edin (`colab/notebooks/ingest_pipeline.ipynb`)
3. Google Drive mount hücresini ekleyin
4. Resume:

```bash
export SP_RESUME_CHECKPOINT="/content/drive/MyDrive/scholarpulse/checkpoints/run-001/stage.sqlite"
export SP_COMPUTE_PLATFORM="kaggle"

python colab/notebooks/ingest_pipeline_runner.py \
  --manifest /content/drive/MyDrive/scholarpulse/manifest.json \
  --checkpoint-dir /content/drive/MyDrive/scholarpulse/checkpoints \
  --run-id run-001 \
  --ingest
```

---

# Bölüm 3: CE (Cross-Encoder) Pipeline

## gte-reranker-modernbert Colab'da nasıl yüklenir

Model: `Alibaba-NLP/gte-reranker-modernbert-base`  
Kod: [`colab/pipeline/models/reranker.py`](../colab/pipeline/models/reranker.py)

Yükleme akışı (otomatik):

1. `SP_USE_REAL_MODELS=1` olmalı
2. `sentence-transformers` kurulu olmalı
3. `CrossEncoder("Alibaba-NLP/gte-reranker-modernbert-base", trust_remote_code=True)` T4'te yüklenir
4. Başarısız olursa fallback: `Qwen/Qwen3-Reranker-0.6B` → Jaccard stub

Manuel doğrulama hücresi:

```python
import os
os.environ["SP_USE_REAL_MODELS"] = "1"

from colab.pipeline.models.reranker import RerankerModel

reranker = RerankerModel("Alibaba-NLP/gte-reranker-modernbert-base")
print("backend:", reranker.backend)   # cross-encoder
print("model:", reranker.model_name)

scores = reranker.score_pairs([
    ("Transformers rely entirely on attention.", "Attention is all you need."),
])
print("score:", scores[0])
reranker.release()
```

VRAM politikası: pass1 (embed) bittikten sonra `embedding_model.release()`; pass4 bittikten sonra `reranker.release()` — aynı anda tek ağır model (`colab/pipeline/main.py`).

## SP_CE_THRESHOLD=0.85 / 0.87

| Env | Varsayılan | Anlam |
|-----|------------|-------|
| `SP_CE_THRESHOLD` | `0.85` | Edge oluşturma minimum CE skoru |
| `SP_HIGH_CONFIDENCE_THRESHOLD` | `0.95` | `confidence_tier=high` eşiği |
| `SP_VECTOR_SCORE_THRESHOLD` | `0.50` | Pass3 candidate FAISS eşiği |

Eşik değiştirme:

```python
os.environ["SP_CE_THRESHOLD"] = "0.87"          # daha sıkı (daha az edge)
os.environ["SP_HIGH_CONFIDENCE_THRESHOLD"] = "0.95"
```

Eval gate referans eşiği: **0.87** (`docs/quality-gates.md`, synthetic smoke).  
Production launch hedefi: **0.85** ile precision ≥ 0.92 (`eval/README.md`).

## Pass 4 rerank akışı

```
pass3 (FAISS top-K candidates)
    │
    ▼
pass4_rerank.run()
    │  pairs = [(source_text, target_text), ...]
    │  scores = reranker.score_pairs(pairs)   # gte-reranker-modernbert
    │
    ├─ ce_score < SP_CE_THRESHOLD  → drop (edge yok)
    │
    └─ ce_score >= SP_CE_THRESHOLD → CiteEdge oluştur
           │
           ├─ ce_score >= 0.95  → confidence_tier: "high"
           ├─ ce_score >= 0.85  → confidence_tier: "medium"
           └─ ce_score <  0.85  → (zaten drop)
    │
    ▼
pass5_intent (SciCite / CiteFusion intent label)
    │
    ▼
pass6_marker_validation
    │
    ▼
pass7_bulk_serialize → bulk-ingest payload
```

Kaynak dosyalar:

- [`colab/pipeline/stages/pass4_rerank.py`](../colab/pipeline/stages/pass4_rerank.py)
- [`colab/pipeline/stages/pass3_candidate_search.py`](../colab/pipeline/stages/pass3_candidate_search.py)

Timing referansı (median paper, T4): pass4 ≈ **11 s**, 140 rerank pair (`docs/COLAB_COMPUTE_BUDGET.md`).

---

# Bölüm 4: End-to-End Doğrulama

`WORKER_URL` ve token'larınızı export edin:

```bash
export WORKER_URL="https://scholarpulse-api.YOUR_SUBDOMAIN.workers.dev"
export COLAB_INGEST_TOKEN="your-token"
export INTERNAL_API_TOKEN="your-internal-token"
```

## curl testleri

### Health

```bash
curl -s "$WORKER_URL/health" | jq .
```

### Search (hybrid FTS + Vectorize)

```bash
curl -s "$WORKER_URL/api/search?q=transformer&limit=5" | jq .
curl -s "$WORKER_URL/api/public/search?q=transformer&limit=5" | jq .
```

### Timeline

```bash
# Önce bir node_id bulun (search sonucundan veya D1)
curl -s "$WORKER_URL/api/cite/timeline?id=NODE_ID&plan=free&limit=10" | jq .
curl -s "$WORKER_URL/api/public/timeline/NODE_ID?limit=10" | jq .
```

### Badge (influential citation)

Tekil:

```bash
curl -s "$WORKER_URL/api/papers/10.48550%2FarXiv.1706.03762/badge" | jq .
```

Batch (max 20 DOI):

```bash
curl -s -X POST "$WORKER_URL/api/papers/badges" \
  -H "Content-Type: application/json" \
  -d '{"dois":["10.48550/arXiv.1706.03762","10.1038/nature12345"]}' | jq .
```

### Bulk-ingest (minimal smoke)

Küçük payload ile token auth testi:

```bash
curl -s -X POST "$WORKER_URL/api/cite/bulk-ingest" \
  -H "Authorization: Bearer $COLAB_INGEST_TOKEN" \
  -H "x-ingest-token: $COLAB_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nodes":[],"edges":[],"vectors":{"paper":[],"sentence":[]},"meta":{"doi":"10.1000/smoke","algorithm_version":"v0-skeleton"}}' | jq .
```

### Vectorize readiness

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  "$WORKER_URL/api/internal/vectorize-indexes" | jq .
```

### Resolve + public paper

```bash
curl -s "$WORKER_URL/api/resolve?id=doi:10.48550/arXiv.1706.03762" | jq .
curl -s "$WORKER_URL/api/public/paper/10.48550%2FarXiv.1706.03762" | jq .
```

## QC raporu /qc-report

Repo kökünden QC pipeline:

```bash
cd scholarpulse-final
corepack pnpm qc:run
corepack pnpm qc:report
```

Rapor dosyası: `.qc/latest-report.json`

Web UI (local dev):

```bash
# Terminal 1: API
corepack pnpm dev:api

# Terminal 2: Web
SCHOLARPULSE_API_BASE_URL=http://127.0.0.1:8787 corepack pnpm dev:web

# Tarayıcı
open http://localhost:3000/qc-report
# veya: corepack pnpm qc:open
```

Kategoriler: Errors · Bottlenecks · Logic Risks · Passed Checks  
Ownership haritası: `.qc/ownership-map.json`

## Eval gates

Detay: [`docs/quality-gates.md`](./quality-gates.md) | [`eval/README.md`](../eval/README.md)

### Coord diff (≤ 1px viewport)

```bash
python eval/coord_diff/coord_diff_harness.py --max-diff-px 1.0
# Beklenen: Summary: 15/15 passed
```

### Citation precision (CE threshold sweep)

Synthetic smoke (local only):

```bash
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.sample.csv \
  --threshold 0.87 \
  --min-precision 0.95 \
  --require-zero-fp \
  --allow-synthetic \
  --sweep-thresholds
```

Production sign-off (gerçek etiketler):

```bash
python eval/citation_benchmark/evaluate_precision.py \
  --input eval/citation_benchmark/labeled_pairs.real.csv \
  --threshold 0.85 \
  --min-precision 0.92 \
  --require-zero-fp \
  --sweep-thresholds \
  --json-output
```

### API typecheck

```bash
corepack pnpm --filter @scholarpulse/api typecheck
corepack pnpm --filter @scholarpulse/web typecheck
```

---

# Bölüm 5: Troubleshooting

## D1 100 param limit

**Belirti:** `too many SQL variables` veya ingest 500 hatası.

**Kök neden:** Cloudflare D1 statement başına max **100 bound parameter** (`BACKEND_LIMITS.md`).

**Çözüm:**

- Payload'ı **≤ 50 paper/chunk** tutun (`BULK_INGEST_MAX_PAPERS_PER_CHUNK`)
- Worker otomatik chunk'lar; Colab serializer uyumlu: `colab/pipeline/serializers/bulk_ingest.py`
- Kural: `rows_per_statement × columns_per_row ≤ 100`

Manuel kontrol:

```bash
# wrangler.toml vars
grep BULK_INGEST apps/api/wrangler.toml
```

## Vectorize-first ordering

**Belirti:** D1'de kayıt var ama search boş; veya tutarsız vektör/metadata.

**Kural:** Worker ingest sırası (`apps/api/README.md`):

1. **Vectorize upsert** (`paper_vectors`, `sentence_vectors`)
2. Vectorize başarılı → **D1 batch UPSERT**
3. Vectorize fail → **abort** (D1'e yazılmaz, DLQ: `ingest_dlq`)

DLQ kontrolü:

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  "$WORKER_URL/api/internal/ingest-log?status=failed&limit=20" | jq .
```

Forbidden metadata keys (Vectorize gate): `text`, `sentence`, `abstract` vb. — yalnızca `doi`, `page`, `sentence_id`, `kind`, `stage`, `year`, `citation_count`, `doi_prefix` (`docs/quality-gates.md`).

## Colab disconnect / checkpoint resume

**Belirti:** Session 12h veya ~90 dk idle sonrası kesildi; manifest yarıda kaldı.

**Çözüm:**

1. Drive checkpoint'in var olduğunu doğrulayın:

```bash
ls /content/drive/MyDrive/scholarpulse/checkpoints/run-001/
# stage.sqlite  cursor.json
```

2. Yeni session'da aynı env + resume:

```bash
export SP_CHECKPOINT_DIR="/content/drive/MyDrive/scholarpulse/checkpoints/run-001"
export SP_RESUME_CHECKPOINT="$SP_CHECKPOINT_DIR/stage.sqlite"

python colab/notebooks/ingest_pipeline_runner.py \
  --manifest /content/drive/MyDrive/scholarpulse/manifest.json \
  --checkpoint-dir /content/drive/MyDrive/scholarpulse/checkpoints \
  --run-id run-001 \
  --ingest
```

3. Idle disconnect önleme: heartbeat hücresi (10 dk):

```python
import os, time, json, urllib.request

url = os.environ["SP_HEARTBEAT_URL"]
token = os.environ["SP_INGEST_TOKEN"]

while True:
    req = urllib.request.Request(
        url,
        data=json.dumps({"platform": "colab", "status": "alive"}).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=15)
        print("heartbeat ok")
    except Exception as e:
        print("heartbeat failed:", e)
    time.sleep(600)
```

4. Colab bittiyse → **Kaggle failover** (Bölüm 2, adım 10).

## Windows build flaky

**Belirti:** `corepack pnpm --filter @scholarpulse/web build` webpack/cache hatası; exit code 1.

**Kök neden:** Windows'ta Next.js webpack cache race (`apps/web/scripts/build.mjs`).

**Otomatik fix (repo'da mevcut):**

- Build script 3 denemeye kadar `.next` temizleyip retry yapar
- `NEXT_DISABLE_WEBPACK_CACHE=1` Windows'ta otomatik set edilir

Manuel retry:

```powershell
cd scholarpulse-final\apps\web
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
$env:NEXT_DISABLE_WEBPACK_CACHE = "1"
corepack pnpm build
```

QC runner Windows fix: `scripts/qc/run.js` — `shell: true` + `rg` yoksa Node regex fallback.

API tarafı Windows'ta genelde stabil; sorun olursa WSL2 kullanın:

```bash
# WSL2 Ubuntu
cd /mnt/d/scholarpulse_mvp\ \(1\)/scholarpulse-final
corepack pnpm install
corepack pnpm --filter @scholarpulse/api exec wrangler deploy
```

---

## Hızlı Referans — Env Özeti

| Ortam | Değişken | Örnek |
|-------|----------|-------|
| Worker secret | `COLAB_INGEST_TOKEN` | `wrangler secret put` |
| Worker secret | `INTERNAL_API_TOKEN` | `/api/internal/*` |
| Worker local | `apps/api/.dev.vars` | Aynı token'lar |
| Pages | `SCHOLARPULSE_API_BASE_URL` | `https://…workers.dev` |
| Colab | `SP_INGEST_TOKEN` | Worker secret ile aynı |
| Colab | `SP_INGEST_API_URL` | `…/api/cite/bulk-ingest` |
| Colab | `SP_USE_REAL_MODELS` | `1` |
| Colab CE | `SP_CE_THRESHOLD` | `0.85` (eval smoke: `0.87`) |
| Colab CE | `SP_RERANK_MODEL` | `Alibaba-NLP/gte-reranker-modernbert-base` |

---

## Kurulum Checklist

- [ ] Cloudflare hesap + `wrangler login`
- [ ] D1 `scholarpulse_d1` + remote migrations (5 dosya)
- [ ] Vectorize `paper_vectors` + `sentence_vectors` (1024 dim, cosine)
- [ ] Worker secrets (`COLAB_INGEST_TOKEN`, `INTERNAL_API_TOKEN`)
- [ ] `wrangler.toml` → `database_id` güncellendi
- [ ] `wrangler deploy` + `/health` OK
- [ ] Pages deploy + `SCHOLARPULSE_API_BASE_URL` set
- [ ] Colab T4 + deps + `SP_USE_REAL_MODELS=1`
- [ ] Tek paper `run_and_ingest.py --ingest` → `algorithm_version=v1-colab-ml`
- [ ] Batch manifest + Drive checkpoint
- [ ] curl search/timeline/badge/bulk-ingest OK
- [ ] `pnpm qc:run` + eval gates PASS
