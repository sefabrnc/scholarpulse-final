"""GROBID client helper for reference extraction."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

import requests

TEI_NS = "http://www.tei-c.org/ns/1.0"
NS = {"tei": TEI_NS}
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
DOI_REGEX = re.compile(r"(10\.\d{4,9}/\S+)", flags=re.IGNORECASE)
ARXIV_REGEX = re.compile(r"\barxiv:(\d{4}\.\d{4,5}(?:v\d+)?)\b", flags=re.IGNORECASE)
YEAR_REGEX = re.compile(r"\b(19|20)\d{2}[a-z]?\b")


class GrobidClient:
    def __init__(self, base_url: str, timeout_s: int = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s

    def process_references(self, pdf_path: str) -> List[Dict[str, Any]]:
        """Extract bibliography entries from a PDF using processReferences."""
        with open(pdf_path, "rb") as pdf_file:
            response = requests.post(
                f"{self.base_url}/api/processReferences",
                files={"input": pdf_file},
                data={"consolidateCitations": "1", "teiCoordinates": "1"},
                timeout=self.timeout_s,
            )
        response.raise_for_status()
        tei_xml = response.text
        return self._parse_tei_references(tei_xml)

    @staticmethod
    def _clean_text(value: str | None) -> str:
        if not value:
            return ""
        return " ".join(value.split()).strip()

    @staticmethod
    def _normalize_doi(raw: str) -> str:
        value = raw.strip()
        for prefix in (
            "https://doi.org/",
            "http://doi.org/",
            "doi.org/",
            "dx.doi.org/",
            "doi:",
        ):
            if value.lower().startswith(prefix):
                value = value[len(prefix) :]
        value = value.strip().rstrip(".,);]")
        match = DOI_REGEX.search(value)
        return match.group(1).rstrip(".,);]") if match else value.lower()

    @staticmethod
    def _extract_year(node: ET.Element | None) -> int | None:
        if node is None:
            return None
        date_value = node.attrib.get("when", "") or "".join(node.itertext())
        year_match = YEAR_REGEX.search(date_value)
        if not year_match:
            return None
        digits = re.sub(r"[^0-9]", "", year_match.group(0))
        return int(digits) if digits else None

    @classmethod
    def _extract_doi_from_item(cls, item: ET.Element) -> str:
        for idno in item.findall(".//tei:idno", NS):
            id_type = (idno.attrib.get("type") or "").lower()
            payload = cls._clean_text("".join(idno.itertext()))
            if not payload:
                continue
            if id_type in {"doi", "pmid", "pmcid"} and id_type == "doi":
                return cls._normalize_doi(payload)
            if id_type == "arxiv":
                arxiv_match = ARXIV_REGEX.search(payload) or re.search(
                    r"(\d{4}\.\d{4,5}(?:v\d+)?)", payload
                )
                if arxiv_match:
                    return f"10.48550/arxiv.{arxiv_match.group(1)}"
        for idno in item.findall(".//tei:idno", NS):
            payload = cls._clean_text("".join(idno.itertext()))
            doi_match = DOI_REGEX.search(payload)
            if doi_match:
                return cls._normalize_doi(doi_match.group(1))
        raw_ref = item.find(".//tei:note[@type='raw_reference']", NS)
        if raw_ref is not None:
            raw_text = cls._clean_text("".join(raw_ref.itertext()))
            doi_match = DOI_REGEX.search(raw_text)
            if doi_match:
                return cls._normalize_doi(doi_match.group(1))
            arxiv_match = ARXIV_REGEX.search(raw_text)
            if arxiv_match:
                return f"10.48550/arxiv.{arxiv_match.group(1)}"
        return ""

    @classmethod
    def _extract_title(cls, item: ET.Element) -> str:
        for xpath in (
            ".//tei:analytic/tei:title[@level='a']",
            ".//tei:analytic/tei:title",
            ".//tei:monogr/tei:title[@level='m']",
            ".//tei:monogr/tei:title",
            ".//tei:title",
        ):
            node = item.find(xpath, NS)
            if node is not None:
                title = cls._clean_text("".join(node.itertext()))
                if title:
                    return title
        return ""

    @classmethod
    def _extract_authors(cls, item: ET.Element) -> List[str]:
        authors: List[str] = []
        for author in item.findall(".//tei:author", NS):
            pers_name = author.find(".//tei:persName", NS)
            if pers_name is not None:
                forenames = [cls._clean_text("".join(node.itertext())) for node in pers_name.findall(".//tei:forename", NS)]
                surname_node = pers_name.find(".//tei:surname", NS)
                surname = cls._clean_text("".join(surname_node.itertext())) if surname_node is not None else ""
                full_name = " ".join(token for token in [*forenames, surname] if token).strip()
                if full_name:
                    authors.append(full_name)
                    continue
            org = author.find(".//tei:orgName", NS)
            if org is not None:
                org_name = cls._clean_text("".join(org.itertext()))
                if org_name:
                    authors.append(org_name)
        return authors

    @classmethod
    def _extract_ref_index(cls, item: ET.Element, fallback: int) -> int:
        xml_id = item.attrib.get(XML_ID, "")
        for pattern in (r"^b(\d+)$", r"^ref(\d+)$", r"^R(\d+)$", r"(\d+)$"):
            match = re.search(pattern, xml_id, flags=re.IGNORECASE)
            if match:
                return int(match.group(1))
        n_attr = item.attrib.get("n")
        if n_attr and n_attr.isdigit():
            return int(n_attr)
        return fallback

    def _parse_tei_references(self, tei_xml: str) -> List[Dict[str, Any]]:
        try:
            root = ET.fromstring(tei_xml)
        except ET.ParseError:
            return [{"ref_index": 1, "raw_text": self._clean_text(tei_xml), "raw_tei": tei_xml}]

        bibl_items = root.findall(".//tei:listBibl/tei:biblStruct", NS)
        if not bibl_items:
            bibl_items = root.findall(f".//{{{TEI_NS}}}biblStruct")

        entries: List[Dict[str, Any]] = []
        for idx, item in enumerate(bibl_items, start=1):
            ref_index = self._extract_ref_index(item, idx)
            title = self._extract_title(item)
            doi = self._extract_doi_from_item(item)
            year = self._extract_year(item.find(".//tei:imprint/tei:date", NS) or item.find(".//tei:date", NS))
            authors = self._extract_authors(item)

            raw_ref_node = item.find(".//tei:note[@type='raw_reference']", NS)
            raw_text = ""
            if raw_ref_node is not None:
                raw_text = self._clean_text("".join(raw_ref_node.itertext()))
            if not raw_text:
                raw_text = self._clean_text("".join(item.itertext()))

            if not doi and raw_text:
                doi_match = DOI_REGEX.search(raw_text)
                if doi_match:
                    doi = self._normalize_doi(doi_match.group(1))

            entries.append(
                {
                    "ref_index": ref_index,
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "doi": doi,
                    "raw_text": raw_text,
                    "raw_tei": ET.tostring(item, encoding="unicode"),
                }
            )

        if entries:
            entries.sort(key=lambda row: int(row.get("ref_index") or 0))
            return entries

        fallback_text = self._clean_text("".join(root.itertext()))
        return [{"ref_index": 1, "raw_text": fallback_text, "raw_tei": tei_xml}]
