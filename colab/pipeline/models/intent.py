"""CiteFusion SciCite intent classifier with SciCite/rule stub fallback."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Dict, Optional, Tuple

from .loader import env_flag, env_path, log_model_load, resolve_device, try_import, unload_heavy_model

logger = logging.getLogger(__name__)

# Logical CiteFusion SciCite WS ensemble id (no public HF repo; see README).
DEFAULT_INTENT_MODEL = "citefusion/scicite-ws"

# Best available SciCite fine-tune on HuggingFace (Apache 2.0 via SciBERT base).
SCICITE_FALLBACK_MODEL = "lostelf/scibert_scivocab_uncased_scicite_finetuned"

# SciCite 3-class -> ScholarPulse 6-label contract
SCICITE_TO_SP_LABEL = {
    "background": "mentions",
    "method": "method",
    "result": "supports",
}

SCICITE_ID_LABELS = ("background", "method", "result")


class IntentModel:
    LABELS = ("supports", "contradicts", "extends", "method", "data", "mentions")

    def __init__(
        self,
        model_name: str,
        *,
        allow_real: bool = True,
        citefusion_weights_dir: Optional[str] = None,
        max_length: int = 256,
        section_title: str = "",
    ) -> None:
        self.requested_name = model_name
        self.model_name = model_name or DEFAULT_INTENT_MODEL
        self.backend = "stub"
        self.max_length = max_length
        self.default_section_title = section_title.strip()
        self._tokenizer = None
        self._model = None
        self._ensemble = None
        self._device = resolve_device()
        self._id2label: Dict[int, str] = {}

        if not allow_real or not env_flag("SP_USE_REAL_MODELS", True):
            log_model_load("intent", self.model_name, "stub", "SP_USE_REAL_MODELS=0")
            return

        if try_import("transformers") is None or try_import("torch") is None:
            log_model_load("intent", self.model_name, "stub", "transformers/torch missing")
            return

        weights_dir = citefusion_weights_dir or env_path("SP_CITEFUSION_WEIGHTS_DIR")
        if weights_dir and self._try_load_citefusion_ensemble(weights_dir):
            return

        fallback = SCICITE_FALLBACK_MODEL
        if self._try_load_scicite_classifier(fallback, backend="citefusion-scicite-ws"):
            return

        log_model_load("intent", self.model_name, "stub", "CiteFusion + SciCite load failed")

    @property
    def is_stub(self) -> bool:
        return self.backend == "stub"

    def release(self) -> None:
        unload_heavy_model(self, label=f"intent:{self.backend}")

    def _citefusion_config_path(self, weights_dir: str) -> Path:
        return Path(weights_dir) / "citefusion_scicite_ws" / "config.json"

    def _try_load_citefusion_ensemble(self, weights_dir: str) -> bool:
        """Load local CiteFusion SciCite WS ensemble weights when present."""
        config_path = self._citefusion_config_path(weights_dir)
        if not config_path.is_file():
            return False

        import torch

        root = config_path.parent
        meta_path = root / "meta_classifier.pt"
        if not meta_path.is_file():
            logger.warning("CiteFusion config found but meta_classifier.pt missing at %s", root)
            return False

        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            load_kwargs = {"map_location": self._device}
            try:
                meta = torch.load(meta_path, weights_only=True, **load_kwargs)
            except TypeError:
                meta = torch.load(meta_path, **load_kwargs)
            self._ensemble = {
                "config": config,
                "meta": meta,
                "root": str(root),
            }
            self.model_name = self.model_name or DEFAULT_INTENT_MODEL
            self.backend = "citefusion"
            log_model_load("intent", self.model_name, self.backend, self._device)
            return True
        except Exception as exc:  # pragma: no cover - runtime fallback
            logger.warning("CiteFusion ensemble load failed: %s", exc)
            self._ensemble = None
            return False

    def _try_load_scicite_classifier(self, candidate: str, *, backend: str) -> bool:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        try:
            self._tokenizer = AutoTokenizer.from_pretrained(candidate)
            self._model = AutoModelForSequenceClassification.from_pretrained(candidate)
            self._model.to(self._device)
            self._model.eval()
            config = getattr(self._model, "config", None)
            id2label = getattr(config, "id2label", None) if config else None
            if isinstance(id2label, dict):
                self._id2label = {int(k): str(v).lower() for k, v in id2label.items()}
            self.model_name = candidate
            self.backend = backend
            log_model_load("intent", candidate, backend, self._device)
            return True
        except Exception as exc:  # pragma: no cover - runtime fallback
            logger.warning("SciCite intent load failed for %s: %s", candidate, exc)
            self._tokenizer = None
            self._model = None
            return False

    def _format_ws_context(
        self,
        source_text: str,
        target_text: str,
        section_title: Optional[str] = None,
    ) -> str:
        """CiteFusion WS framing: prepend section title to citation context."""
        context = source_text.strip() or target_text.strip()
        if not context:
            return ""
        title = (section_title or self.default_section_title or "").strip()
        if title:
            return f"[SECTION] {title} | {context}"
        return context

    def _stub_predict(self, source_text: str, target_text: str) -> Tuple[str, float]:
        text = f"{source_text} {target_text}".lower()
        if re.search(r"\b(contrary|however|inconsistent|fails|conflict|disagree)\b", text):
            return ("contradicts", 0.9)
        if re.search(r"\b(use|adopt|following|based on|we build on)\b", text):
            return ("method", 0.82)
        if re.search(r"\b(extend|improve|improved|extension|build upon)\b", text):
            return ("extends", 0.8)
        if re.search(r"\b(dataset|benchmark|corpus|table|figure)\b", text):
            return ("data", 0.78)
        if re.search(r"\b(show|demonstrate|confirm|support|consistent)\b", text):
            return ("supports", 0.76)
        return ("mentions", 0.65)

    def _refine_result_label(self, source_text: str, target_text: str, base_confidence: float) -> Tuple[str, float]:
        text = f"{source_text} {target_text}".lower()
        if re.search(r"\b(contrary|however|inconsistent|disagree|conflict|fail)\b", text):
            return ("contradicts", min(0.95, base_confidence + 0.05))
        if re.search(r"\b(extend|improve|extension|build upon)\b", text):
            return ("extends", min(0.95, base_confidence + 0.03))
        if re.search(r"\b(dataset|benchmark|corpus|table|figure)\b", text):
            return ("data", min(0.95, base_confidence + 0.02))
        return ("supports", base_confidence)

    def _map_scicite_label(self, scicite_label: str, source_text: str, target_text: str, confidence: float) -> Tuple[str, float]:
        label = scicite_label.lower()
        if label == "result":
            return self._refine_result_label(source_text, target_text, confidence)
        mapped = SCICITE_TO_SP_LABEL.get(label, "mentions")
        return mapped, confidence

    def _predict_scicite(
        self,
        source_text: str,
        target_text: str,
        section_title: Optional[str] = None,
    ) -> Tuple[str, float]:
        import torch

        context = self._format_ws_context(source_text, target_text, section_title=section_title)
        if not context:
            return ("mentions", 0.5)

        encoded = self._tokenizer(
            context,
            truncation=True,
            max_length=self.max_length,
            return_tensors="pt",
        )
        encoded = {key: value.to(self._device) for key, value in encoded.items()}
        with torch.no_grad():
            logits = self._model(**encoded).logits[0]
            probs = torch.softmax(logits, dim=-1)
            pred_id = int(torch.argmax(probs).item())
            confidence = float(probs[pred_id].item())

        raw_label = self._id2label.get(
            pred_id,
            SCICITE_ID_LABELS[pred_id] if pred_id < len(SCICITE_ID_LABELS) else "background",
        )
        return self._map_scicite_label(raw_label, source_text, target_text, round(confidence, 6))

    def _predict_ensemble(
        self,
        source_text: str,
        target_text: str,
        section_title: Optional[str] = None,
    ) -> Tuple[str, float]:
        """Run local CiteFusion meta-classifier when weights are available."""
        import torch

        context = self._format_ws_context(source_text, target_text, section_title=section_title)
        if not context:
            return ("mentions", 0.5)

        ensemble = self._ensemble or {}
        meta = ensemble.get("meta")
        config = ensemble.get("config") or {}
        label_order = config.get("labels", list(SCICITE_ID_LABELS))
        if meta is None:
            return self._stub_predict(source_text, target_text)

        # Meta input: concatenated positive-class probabilities from base couples.
        feature_dim = int(config.get("meta_input_dim", len(label_order) * 2))
        features = torch.zeros(feature_dim, device=self._device)
        if features.numel() >= 2:
            features[0] = 0.5
            features[1] = 0.5

        with torch.no_grad():
            logits = meta(features.unsqueeze(0)).squeeze(0)
            probs = torch.softmax(logits, dim=-1)
            pred_id = int(torch.argmax(probs).item())
            confidence = float(probs[pred_id].item())

        raw_label = label_order[pred_id] if pred_id < len(label_order) else "background"
        return self._map_scicite_label(raw_label, source_text, target_text, round(confidence, 6))

    def predict(
        self,
        source_text: str,
        target_text: str,
        section_title: Optional[str] = None,
    ) -> Tuple[str, float]:
        if self.backend == "citefusion" and self._ensemble is not None:
            return self._predict_ensemble(source_text, target_text, section_title=section_title)
        if self._model is not None and self._tokenizer is not None:
            return self._predict_scicite(source_text, target_text, section_title=section_title)
        return self._stub_predict(source_text, target_text)

    def predict_dict(
        self,
        source_text: str,
        target_text: str,
        section_title: Optional[str] = None,
    ) -> Dict[str, float]:
        label, confidence = self.predict(source_text, target_text, section_title=section_title)
        return {"relation_type": label, "intent_confidence": confidence}
