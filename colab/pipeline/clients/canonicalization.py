"""DOI canonicalization helpers backed by OpenAlex IDs."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .openalex import OpenAlexClient

DOI_CORE_REGEX = re.compile(r"^10\.\d{4,9}/\S+$", flags=re.IGNORECASE)
DOI_EXTRACT_REGEX = re.compile(r"(10\.\d{4,9}/\S+)", flags=re.IGNORECASE)
ARXIV_ID_REGEX = re.compile(r"\barxiv:(\d{4}\.\d{4,5}(?:v\d+)?)\b", flags=re.IGNORECASE)


def normalize_doi(raw: str) -> str:
    if not raw:
        return ""
    value = raw.strip().lower()
    for prefix in (
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi.org/",
        "dx.doi.org/",
        "doi:",
    ):
        if value.startswith(prefix):
            value = value[len(prefix) :]
    value = value.strip().rstrip(".,);]>")
    match = DOI_EXTRACT_REGEX.search(value)
    if match:
        value = match.group(1).rstrip(".,);]>")
    arxiv_match = ARXIV_ID_REGEX.search(value)
    if arxiv_match:
        return f"10.48550/arxiv.{arxiv_match.group(1)}"
    return value


def is_valid_doi(value: str) -> bool:
    normalized = normalize_doi(value)
    if not normalized:
        return False
    return bool(DOI_CORE_REGEX.match(normalized))


class CanonicalDoiResolver:
    def __init__(self, openalex: OpenAlexClient, match_threshold: float = 0.92) -> None:
        self.openalex = openalex
        self.match_threshold = match_threshold

    def resolve(self, doi: str) -> Tuple[str, Dict[str, str]]:
        """
        Return (canonical_doi, alias_map).

        alias_map stores alias_doi -> canonical_doi pairs.
        """
        normalized = normalize_doi(doi)
        if not is_valid_doi(normalized):
            return normalized, {}

        work = self.openalex.get_work_by_doi(normalized)
        if not work:
            return normalized, {}

        canonical = normalize_doi(work.get("doi", normalized))
        if not is_valid_doi(canonical):
            canonical = normalized

        alias_map: Dict[str, str] = {}
        if normalized and normalized != canonical:
            alias_map[normalized] = canonical

        ids = work.get("ids", {})
        for id_type, id_value in ids.items():
            if not isinstance(id_value, str):
                continue
            if id_type == "doi":
                alias = normalize_doi(id_value)
                if alias and alias != canonical and is_valid_doi(alias):
                    alias_map[alias] = canonical
            elif id_type in {"pmid", "pmcid", "mag"}:
                # Preserve crosswalk ids in alias map for downstream reconciliation.
                alias_map[f"{id_type}:{id_value}"] = canonical

        return canonical, alias_map

    @staticmethod
    def _tokenize(value: str) -> List[str]:
        return re.findall(r"[a-z0-9]+", value.lower())

    @classmethod
    def _title_overlap(cls, lhs: str, rhs: str) -> float:
        left = set(cls._tokenize(lhs))
        right = set(cls._tokenize(rhs))
        if not left or not right:
            return 0.0
        return len(left.intersection(right)) / len(left.union(right))

    @staticmethod
    def _extract_year(value: Any) -> Optional[int]:
        if isinstance(value, int):
            return value
        if not isinstance(value, str):
            return None
        match = re.search(r"\b(19|20)\d{2}\b", value)
        if not match:
            return None
        return int(match.group(0))

    @staticmethod
    def _author_match_score(reference_authors: List[str], candidate_authorships: List[Dict[str, Any]]) -> float:
        if not reference_authors:
            return 0.0
        candidate_names = {
            re.sub(r"[^a-z0-9]", "", str(author.get("author", {}).get("display_name", "")).lower())
            for author in candidate_authorships
        }
        candidate_names = {name for name in candidate_names if name}
        if not candidate_names:
            return 0.0
        hits = 0
        for author in reference_authors:
            surname = re.sub(r"[^a-z0-9]", "", author.lower().split()[-1])
            if any(surname and surname in cand for cand in candidate_names):
                hits += 1
        return hits / max(1, len(reference_authors))

    def search_and_resolve_reference(self, reference: Dict[str, Any]) -> Tuple[Optional[str], Dict[str, str]]:
        ref_doi = normalize_doi(str(reference.get("doi") or ""))
        if is_valid_doi(ref_doi):
            return self.resolve(ref_doi)

        query = str(reference.get("title") or reference.get("raw_text") or "").strip()
        if not query:
            return None, {}

        results = self.openalex.search_work(query, per_page=5)
        best_doi: Optional[str] = None
        best_score = 0.0
        best_aliases: Dict[str, str] = {}
        best_candidate: Optional[Dict[str, Any]] = None

        ref_title = str(reference.get("title") or "")
        ref_year = self._extract_year(reference.get("year"))
        ref_authors = [str(author) for author in (reference.get("authors") or []) if str(author).strip()]

        for candidate in results.get("results", []):
            doi = candidate.get("doi")
            if not isinstance(doi, str):
                continue
            cand_title = str(candidate.get("title") or "")
            title_score = self._title_overlap(ref_title or query, cand_title)
            cand_year = self._extract_year(candidate.get("publication_year"))
            year_score = 0.0
            if ref_year and cand_year:
                year_score = 1.0 if abs(ref_year - cand_year) <= 1 else 0.0
            elif not ref_year:
                year_score = 0.5
            author_score = self._author_match_score(ref_authors, candidate.get("authorships") or [])
            score = (0.55 * title_score) + (0.30 * author_score) + (0.15 * year_score)
            if score > best_score:
                canonical = normalize_doi(doi)
                if not is_valid_doi(canonical):
                    continue
                best_doi = canonical
                best_score = score
                best_candidate = candidate
                best_aliases = {}
                ids = candidate.get("ids") or {}
                for id_type, id_value in ids.items():
                    if id_type == "doi" and isinstance(id_value, str):
                        alias = normalize_doi(id_value)
                        if alias and alias != canonical and is_valid_doi(alias):
                            best_aliases[alias] = canonical

        if best_doi and best_candidate and self._passes_strict_gate(
            reference, best_score, ref_title, ref_year, ref_authors, best_candidate
        ):
            return best_doi, best_aliases
        return None, {}

    def _passes_strict_gate(
        self,
        reference: Dict[str, Any],
        best_score: float,
        ref_title: str,
        ref_year: Optional[int],
        ref_authors: List[str],
        candidate: Dict[str, Any],
    ) -> bool:
        if best_score < self.match_threshold:
            return False

        cand_title = str(candidate.get("title") or "")
        title_score = self._title_overlap(ref_title or str(reference.get("raw_text") or ""), cand_title)
        if title_score < 0.75:
            return False

        if ref_authors:
            author_score = self._author_match_score(ref_authors, candidate.get("authorships") or [])
            if author_score <= 0:
                return False

        if ref_year is not None:
            cand_year = self._extract_year(candidate.get("publication_year"))
            if cand_year is not None and abs(ref_year - cand_year) > 1:
                return False

        doi = candidate.get("doi")
        if isinstance(doi, str) and not is_valid_doi(normalize_doi(doi)):
            return False

        return True

    def search_and_resolve(self, ref_text: str) -> Optional[str]:
        resolved, _aliases = self.search_and_resolve_reference({"raw_text": ref_text})
        if resolved:
            return resolved
        return None
