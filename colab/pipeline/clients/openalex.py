"""OpenAlex helper client."""

from __future__ import annotations

from typing import Any, Dict, Optional

import requests


class OpenAlexClient:
    def __init__(self, base_url: str, timeout_s: int = 30, mailto: Optional[str] = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.mailto = mailto

    def _params(self) -> Dict[str, str]:
        params: Dict[str, str] = {}
        if self.mailto:
            params["mailto"] = self.mailto
        return params

    def get_work_by_doi(self, doi: str) -> Optional[Dict[str, Any]]:
        doi = doi.lower().strip()
        url = f"{self.base_url}/works/https://doi.org/{doi}"
        response = requests.get(url, params=self._params(), timeout=self.timeout_s)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    def search_work(self, query: str, per_page: int = 5) -> Dict[str, Any]:
        response = requests.get(
            f"{self.base_url}/works",
            params={**self._params(), "search": query, "per-page": str(per_page)},
            timeout=self.timeout_s,
        )
        response.raise_for_status()
        return response.json()

