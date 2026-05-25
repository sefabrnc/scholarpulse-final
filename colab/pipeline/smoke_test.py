"""Smoke tests for Colab pipeline (stub path, no GPU required)."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

# Run as `python -m colab.pipeline.smoke_test` from repo root to avoid
# shadowing stdlib `types` via colab/pipeline/types.py on sys.path.
REPO_ROOT = Path(__file__).resolve().parents[2]
if Path.cwd().name == "pipeline" and str(Path.cwd()) in sys.path:
    sys.path.remove(str(Path.cwd()))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

os.environ.setdefault("SP_USE_REAL_MODELS", "0")

from colab.pipeline.clients.canonicalization import is_valid_doi, normalize_doi
from colab.pipeline.clients.grobid import GrobidClient
from colab.pipeline.config import PipelineConfig
from colab.pipeline.models import compute_algorithm_version, create_models
from colab.pipeline.models.embedding import EmbeddingModel
from colab.pipeline.models.intent import DEFAULT_INTENT_MODEL, IntentModel
from colab.pipeline.models.reranker import RerankerModel

SAMPLE_TEI = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <back>
      <div>
        <listBibl>
          <biblStruct xml:id="b0">
            <analytic>
              <title level="a">Attention Is All You Need</title>
              <author>
                <persName><forename>Ashish</forename><surname>Vaswani</surname></persName>
              </author>
            </analytic>
            <monogr>
              <title level="m">NeurIPS</title>
              <imprint><date when="2017">2017</date></imprint>
            </monogr>
            <idno type="DOI">10.48550/arXiv.1706.03762</idno>
            <note type="raw_reference">Vaswani et al., Attention Is All You Need, 2017.</note>
          </biblStruct>
          <biblStruct xml:id="b1">
            <monogr>
              <title level="m">Deep Residual Learning</title>
              <author><persName><surname>He</surname></persName></author>
              <imprint><date when="2016">2016</date></imprint>
            </monogr>
            <idno type="arxiv">arxiv:1512.03385</idno>
          </biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>
"""


class PipelineSmokeTest(unittest.TestCase):
    def test_intent_default_model_id(self) -> None:
        self.assertEqual(DEFAULT_INTENT_MODEL, "citefusion/scicite-ws")
        intent = IntentModel("test-intent")
        self.assertEqual(intent.backend, "stub")
        self.assertTrue(intent.is_stub)

    def test_stub_models_and_algorithm_version(self) -> None:
        embed = EmbeddingModel("test-embed")
        rerank = RerankerModel("test-rerank")
        intent = IntentModel("test-intent")
        self.assertTrue(embed.is_stub)
        self.assertTrue(rerank.is_stub)
        self.assertTrue(intent.is_stub)
        self.assertEqual(compute_algorithm_version(embed, rerank, intent), "v0-skeleton")

        vectors = embed.embed(["hello world", "another sentence"])
        self.assertEqual(len(vectors), 2)
        self.assertEqual(len(vectors[0]), embed.embedding_dim)

        scores = rerank.score_pairs([("hello world", "hello there"), ("a", "b")])
        self.assertEqual(len(scores), 2)
        self.assertTrue(all(0.0 <= score <= 1.0 for score in scores))

        label, confidence = intent.predict("We build on prior work.", "Earlier method paper.")
        self.assertIn(label, IntentModel.LABELS)
        self.assertGreater(confidence, 0.0)

    def test_create_models_stub(self) -> None:
        os.environ["SP_USE_REAL_MODELS"] = "0"
        config = PipelineConfig()
        embed, rerank, intent, version = create_models(config)
        self.assertEqual(version, "v0-skeleton")
        self.assertTrue(all(model.is_stub for model in (embed, rerank, intent)))

    def test_config_free_stack_defaults(self) -> None:
        config = PipelineConfig()
        self.assertEqual(config.embed_model, "Qwen/Qwen3-Embedding-0.6B")
        self.assertEqual(config.rerank_model, "Alibaba-NLP/gte-reranker-modernbert-base")
        self.assertEqual(config.intent_model, "citefusion/scicite-ws")
        self.assertEqual(config.grobid_mode, "auto")

    def test_intent_ws_context_and_partial_version(self) -> None:
        intent = IntentModel("citefusion/scicite-ws")
        label, confidence = intent.predict(
            "We adopt the method from prior work.",
            "Earlier baseline paper.",
            section_title="Methods",
        )
        self.assertIn(label, IntentModel.LABELS)
        self.assertGreater(confidence, 0.0)

        embed = EmbeddingModel("test-embed")
        rerank = RerankerModel("test-rerank")
        intent.backend = "citefusion-scicite-ws"
        self.assertEqual(compute_algorithm_version(embed, rerank, intent), "v1-colab-ml-partial")

    def test_intent_contradicts_stub(self) -> None:
        intent = IntentModel("test-intent")
        label, _ = intent.predict(
            "However, this result is contrary to prior findings.",
            "Original claim paper.",
        )
        self.assertEqual(label, "contradicts")

    def test_doi_normalization(self) -> None:
        self.assertEqual(normalize_doi("https://doi.org/10.1038/nature12373"), "10.1038/nature12373")
        self.assertEqual(normalize_doi("doi:10.1038/nature12373."), "10.1038/nature12373")
        self.assertEqual(normalize_doi("arxiv:1706.03762"), "10.48550/arxiv.1706.03762")
        self.assertTrue(is_valid_doi("10.1038/nature12373"))
        self.assertFalse(is_valid_doi("not-a-doi"))

    def test_grobid_tei_parse(self) -> None:
        client = GrobidClient(base_url="http://localhost:8070")
        refs = client._parse_tei_references(SAMPLE_TEI)
        self.assertEqual(len(refs), 2)
        self.assertEqual(refs[0]["ref_index"], 0)
        self.assertIn("attention", refs[0]["title"].lower())
        self.assertTrue(refs[0]["doi"].startswith("10."))
        self.assertEqual(refs[1]["year"], 2016)
        self.assertTrue(refs[1]["doi"].startswith("10.48550/arxiv."))

    def test_grobid_hybrid_routing_dirty(self) -> None:
        from colab.pipeline.helpers.pdf_quality import assess_pdf_for_grobid
        from colab.pipeline.stages import pass0_5_reference_parser
        from colab.pipeline.types import PaperInput, PipelineContext

        config = PipelineConfig()
        os.environ["SP_GROBID_MODE"] = "auto"
        config = PipelineConfig()
        context = PipelineContext(
            config=config,
            paper=PaperInput(
                doi="10.1000/dirty",
                pdf_path="missing.pdf",
                metadata={"raw_text": "Short."},
            ),
            extracted_text_len=6,
        )
        route, metrics = assess_pdf_for_grobid(context)
        self.assertEqual(route, "dirty")
        self.assertIn("low_extract_chars", metrics.get("reason", ""))

        context.artifacts["raw_text"] = (
            "Body text.\nReferences\n"
            "[1] A. Author, Title, 2020. doi:10.1038/nature12373"
        )
        context.extracted_text_len = len(context.artifacts["raw_text"])
        selected = pass0_5_reference_parser._resolve_route(context)
        self.assertEqual(selected, "regex")

    def test_grobid_hybrid_routing_clean(self) -> None:
        from colab.pipeline.helpers.pdf_quality import assess_pdf_for_grobid
        from colab.pipeline.stages import pass0_5_reference_parser
        from colab.pipeline.types import PaperInput, PipelineContext

        os.environ["SP_GROBID_MODE"] = "auto"
        config = PipelineConfig()
        raw = (
            "Introduction with enough extracted text for a digital-born PDF paper. "
            * 40
        )
        raw += "\nReferences\n[1] Vaswani et al., Attention Is All You Need, 2017."
        context = PipelineContext(
            config=config,
            paper=PaperInput(doi="10.1000/clean", pdf_path="missing.pdf", metadata={}),
            extracted_text_len=len(raw),
        )
        context.artifacts["raw_text"] = raw
        # Keep chars/page above CHARS_PER_PAGE_DIRTY (450) for a digital-born sample.
        context.artifacts["page_count"] = 5
        route, _ = assess_pdf_for_grobid(context)
        self.assertEqual(route, "clean")
        self.assertEqual(pass0_5_reference_parser._resolve_route(context), "grobid")


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PipelineSmokeTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
