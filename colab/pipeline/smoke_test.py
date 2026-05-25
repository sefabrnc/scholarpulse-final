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
from colab.pipeline.clients.pdf_fetch import is_valid_pdf_file, safe_doi_filename
from colab.pipeline.clients.pdf_resolver import (
    PdfResolver,
    arxiv_pdf_url_from_doi,
    _pick_openalex_pdf,
)
from colab.pipeline.ingest_queue import dois_from_pending_bibs
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
        self.assertEqual(config.intra_paper_ce_threshold, 0.55)

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

    def test_arxiv_pdf_url_from_doi(self) -> None:
        url = arxiv_pdf_url_from_doi("10.48550/arXiv.1706.03762")
        self.assertEqual(url, "https://arxiv.org/pdf/1706.03762.pdf")

    def test_openalex_pdf_pick(self) -> None:
        work = {
            "best_oa_location": {"pdf_url": "https://example.org/paper.pdf"},
            "open_access": {"oa_url": "https://example.org/html"},
        }
        picked = _pick_openalex_pdf(work)
        self.assertIsNotNone(picked)
        self.assertEqual(picked[0], "https://example.org/paper.pdf")
        self.assertEqual(picked[1], "openalex_best_oa")

    def test_pdf_resolver_arxiv_without_network(self) -> None:
        class StubOpenAlex:
            def get_work_by_doi(self, doi: str):
                return None

        resolver = PdfResolver(StubOpenAlex())
        resolved = resolver.resolve_pdf_url("10.48550/arXiv.1706.03762")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.source, "arxiv_doi")

    def test_ingest_queue_doi_extraction(self) -> None:
        dois = dois_from_pending_bibs(
            [
                {
                    "source_ref": "upload-1",
                    "payload": {
                        "target_doi": "10.1038/nature12373",
                        "source_doi": "10.48550/arXiv.1706.03762",
                    },
                },
                {
                    "source_ref": "10.1126/science.abc1234",
                    "payload": {"kind": "library_import", "doi": "10.1126/science.abc1234"},
                },
            ]
        )
        self.assertEqual(dois[0], "10.1038/nature12373")
        self.assertIn("10.1126/science.abc1234", dois)

    def test_safe_doi_filename(self) -> None:
        self.assertEqual(
            safe_doi_filename("10.48550/arXiv.1706.03762"),
            "10.48550_arxiv.1706.03762",
        )

    def test_is_valid_pdf_file(self) -> None:
        path = Path(REPO_ROOT) / "colab" / "pipeline" / "smoke_test.py"
        self.assertFalse(is_valid_pdf_file(path))

    def test_extract_outbound_cross_citations(self) -> None:
        from colab.pipeline.cross_citations import extract_outbound_cross_citations

        payload = {
            "nodes": [
                {
                    "id": "src1",
                    "doiNorm": "10.1000/a",
                    "nodeType": "sentence",
                    "title": "Transformers are useful [3].",
                },
                {
                    "id": "tgt1",
                    "doiNorm": "10.1000/b",
                    "nodeType": "reference",
                    "title": "Attention Is All You Need",
                },
            ],
            "edges": [
                {
                    "id": "edge1",
                    "fromNodeId": "src1",
                    "toNodeId": "tgt1",
                    "evidenceRef": "ref:3",
                }
            ],
        }
        found = extract_outbound_cross_citations(payload, "10.1000/a")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].target_doi, "10.1000/b")
        self.assertEqual(found[0].ref_index, 3)

    def test_gather_incoming_cross_citations_checkpoint(self) -> None:
        import shutil
        import tempfile

        from colab.pipeline.checkpoint import CheckpointStore
        from colab.pipeline.cross_citations import IncomingCrossCitation
        from colab.pipeline.incoming_citations import gather_incoming_cross_citations

        tmp = tempfile.mkdtemp()
        try:
            store = CheckpointStore(tmp, run_id="smoke")
            store.record_cross_citations(
                [
                    IncomingCrossCitation(
                        edge_id="edge-old",
                        source_id="a1",
                        source_doi="10.1000/a",
                        source_text="Prior work on transformers [3].",
                        old_target_id="ref-placeholder",
                        target_doi="10.1000/b",
                        ref_index=3,
                    )
                ]
            )
            found = gather_incoming_cross_citations(
                "10.1000/b",
                PipelineConfig(),
                checkpoint_store=store,
            )
            self.assertEqual(len(found), 1)
            self.assertEqual(found[0].edge_id, "edge-old")
            self.assertEqual(found[0].source_id, "a1")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_intra_paper_cite_edges_stub(self) -> None:
        from dataclasses import replace

        from colab.pipeline.stages import pass3_candidate_search, pass4_rerank, pass6_marker_validation
        from colab.pipeline.types import PaperInput, PipelineContext, SentenceNode

        config = replace(
            PipelineConfig(),
            vector_score_threshold=0.0,
            intra_paper_ce_threshold=0.35,
            ce_threshold=0.85,
        )
        source_text = "Attention is all you need for sequence transduction models [1]."
        context = PipelineContext(
            config=config,
            paper=PaperInput(doi="10.1000/paper", pdf_path="x.pdf", metadata={}),
        )
        context.nodes = [
            SentenceNode(
                sentence_id="src1",
                doi="10.1000/paper",
                page=1,
                norm_x=0.1,
                norm_y=0.2,
                norm_w=0.8,
                norm_h=0.05,
                text=source_text,
            )
        ]
        context.references = [
            {
                "ref_index": 1,
                "raw_text": "Vaswani et al., Attention Is All You Need, 2017.",
                "title": "Attention Is All You Need",
                "resolved_doi": "10.48550/arXiv.1706.03762",
            }
        ]
        context.artifacts["resolved_references"] = list(context.references)

        embed = EmbeddingModel("test-embed")
        rerank = RerankerModel("test-rerank")
        try:
            context.artifacts["node_embeddings"] = {"src1": embed.embed([source_text])[0]}
            context = pass3_candidate_search.run(context, embedding_model=embed)
            self.assertGreater(len(context.artifacts.get("candidates", [])), 0)

            context = pass4_rerank.run(context, reranker=rerank)
            self.assertGreater(len(context.edges), 0, "pass4 should keep intra-paper cite edges")

            context = pass6_marker_validation.run(context)
            self.assertGreater(len(context.edges), 0, "pass6 should keep valid marker edges")
            self.assertEqual(context.edges[0].ref_index, 1)
        finally:
            embed.release()
            rerank.release()

    def test_pass8_cross_paper_resolve_stub(self) -> None:
        from colab.pipeline.cross_citations import IncomingCrossCitation
        from colab.pipeline.stages import pass8_cross_paper_resolve
        from colab.pipeline.types import PaperInput, PipelineContext, SentenceNode

        from dataclasses import replace

        config = replace(
            PipelineConfig(),
            cross_paper_ce_threshold=0.5,
            vector_score_threshold=0.0,
        )
        context = PipelineContext(
            config=config,
            paper=PaperInput(doi="10.1000/b", pdf_path="x.pdf", metadata={}),
        )
        text = "Attention is all you need for sequence transduction models."
        context.nodes = [
            SentenceNode(
                sentence_id="b1",
                doi="10.1000/b",
                page=1,
                norm_x=0.1,
                norm_y=0.2,
                norm_w=0.8,
                norm_h=0.05,
                text=text,
            )
        ]
        embed = EmbeddingModel("test-embed")
        rerank = RerankerModel("test-rerank")
        intent = IntentModel("test-intent")
        context.artifacts["node_embeddings"] = {"b1": embed.embed([text])[0]}
        incoming = [
            IncomingCrossCitation(
                edge_id="edge-old",
                source_id="a1",
                source_doi="10.1000/a",
                source_text="Attention is all you need for modern sequence transduction [3].",
                old_target_id="ref-placeholder",
                target_doi="10.1000/b",
                ref_index=3,
            )
        ]
        try:
            context = pass8_cross_paper_resolve.run(
                context,
                incoming,
                embedding_model=embed,
                reranker=rerank,
                intent_model=intent,
            )
        finally:
            embed.release()
            rerank.release()
            intent.release()

        self.assertGreaterEqual(len(context.edges), 1)
        self.assertEqual(context.edges[-1].source_id, "a1")
        self.assertEqual(context.edges[-1].target_id, "b1")
        self.assertTrue(context.artifacts.get("superseded_edges"))

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

    def test_ocr_skip_not_triggered_when_nodes_present(self) -> None:
        from colab.pipeline.policies.skip_policies import should_skip_paper_for_ocr

        self.assertFalse(
            should_skip_paper_for_ocr(
                text_len=0,
                node_count=12,
                min_extract_chars=100,
            )
        )

    def test_ocr_skip_bypass_env(self) -> None:
        from colab.pipeline.policies.skip_policies import should_skip_paper_for_ocr

        self.assertFalse(
            should_skip_paper_for_ocr(
                text_len=0,
                node_count=0,
                min_extract_chars=100,
                bypass=True,
            )
        )

    def test_pass0_arxiv_attention_extracts(self) -> None:
        import shutil
        import tempfile

        from colab.pipeline.clients.pdf_fetch import PdfFetcher
        from colab.pipeline.stages import pass0_preflight_extract
        from colab.pipeline.types import PaperInput, PipelineContext

        tmp = tempfile.mkdtemp()
        try:
            fetcher = PdfFetcher(cache_dir=tmp)
            pdf = fetcher.download(
                "10.48550/arXiv.1706.03762",
                "https://arxiv.org/pdf/1706.03762.pdf",
                force=True,
            )
            config = PipelineConfig()
            context = PipelineContext(
                config=config,
                paper=PaperInput(
                    doi="10.48550/arXiv.1706.03762",
                    pdf_path=str(pdf),
                    metadata={},
                ),
            )
            context = pass0_preflight_extract.run(context)
            self.assertIsNone(context.skipped_reason)
            self.assertGreater(len(context.nodes), 50)
            self.assertGreater(context.extracted_text_len, config.min_extract_chars)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_pdf_fetch_rejects_html_body(self) -> None:
        from colab.pipeline.clients.pdf_fetch import looks_like_html

        self.assertTrue(looks_like_html(b"<!DOCTYPE html><html><body>x</body></html>"))
        self.assertTrue(looks_like_html(b"  <html><head></head></html>"))
        self.assertFalse(looks_like_html(b"%PDF-1.4 fake"))

    def test_pdf_fetch_redownloads_empty_text_cache(self) -> None:
        import shutil
        import tempfile

        from colab.pipeline.clients.pdf_fetch import PdfFetcher, pdf_has_extractable_text

        tmp = tempfile.mkdtemp()
        try:
            fetcher = PdfFetcher(cache_dir=tmp)
            cache_path = fetcher.cache_path_for_doi("10.48550/arXiv.1706.03762")
            cache_path.write_bytes(b"%PDF-1.4\n" + b"0 " * 2000)
            self.assertFalse(pdf_has_extractable_text(cache_path, min_chars=100))
            self.assertIsNone(fetcher.get_cached("10.48550/arXiv.1706.03762", min_text_chars=100))

            good_pdf = fetcher.download(
                "10.48550/arXiv.1706.03762",
                "https://arxiv.org/pdf/1706.03762.pdf",
                min_text_chars=100,
            )
            self.assertTrue(pdf_has_extractable_text(good_pdf, min_chars=100))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_pdf_cache_rejects_empty_text(self) -> None:
        import shutil
        import tempfile

        from colab.pipeline.clients.pdf_fetch import PdfFetcher, pdf_has_extractable_text

        tmp = tempfile.mkdtemp()
        try:
            fetcher = PdfFetcher(cache_dir=tmp)
            pdf = fetcher.download(
                "10.48550/arXiv.1706.03762",
                "https://arxiv.org/pdf/1706.03762.pdf",
                force=True,
                min_text_chars=100,
            )
            self.assertTrue(pdf_has_extractable_text(pdf, min_chars=100))
            cached = fetcher.get_cached("10.48550/arXiv.1706.03762", min_text_chars=100)
            self.assertIsNotNone(cached)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PipelineSmokeTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
