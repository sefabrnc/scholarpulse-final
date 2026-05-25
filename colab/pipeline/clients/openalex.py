"""OpenAlex helper client with polite-pool support, rate limiting, and retries."""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional, Tuple

import requests

DEFAULT_MIN_DELAY_WITH_MAILTO_S = 0.2
DEFAULT_MIN_DELAY_WITHOUT_MAILTO_S = 1.0
DEFAULT_MAX_RETRIES = 6
DEFAULT_BACKOFF_BASE_S = 1.0


class OpenAlexRequestError(Exception):
    """Raised when OpenAlex returns a persistent HTTP error after retries."""

    def __init__(self, status_code: int, url: str, message: str = "") -> None:
        self.status_code = status_code
        self.url = url
        super().__init__(message or f"OpenAlex HTTP {status_code} for {url}")


class OpenAlexClient:
    def __init__(
        self,
        base_url: str,
        timeout_s: int = 30,
        mailto: Optional[str] = None,
        min_delay_s: Optional[float] = None,
        max_retries: Optional[int] = None,
        backoff_base_s: Optional[float] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.mailto = (mailto or "").strip() or None
        if min_delay_s is not None:
            self.min_delay_s = min_delay_s
        else:
            self.min_delay_s = (
                DEFAULT_MIN_DELAY_WITH_MAILTO_S
                if self.mailto
                else DEFAULT_MIN_DELAY_WITHOUT_MAILTO_S
            )
        self.max_retries = max_retries if max_retries is not None else DEFAULT_MAX_RETRIES
        self.backoff_base_s = (
            backoff_base_s if backoff_base_s is not None else DEFAULT_BACKOFF_BASE_S
        )
        self._lock = threading.Lock()
        self._last_request_at = 0.0
        self._work_by_doi_cache: Dict[str, Optional[Dict[str, Any]]] = {}
        self._search_cache: Dict[Tuple[str, int], Dict[str, Any]] = {}

    def _params(self) -> Dict[str, str]:
        params: Dict[str, str] = {}
        if self.mailto:
            params["mailto"] = self.mailto
        return params

    def _rate_limit(self) -> None:
        with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_request_at
            if elapsed < self.min_delay_s:
                time.sleep(self.min_delay_s - elapsed)
            self._last_request_at = time.monotonic()

    @staticmethod
    def _parse_retry_after(response: requests.Response) -> float:
        retry_after = response.headers.get("Retry-After")
        if not retry_after:
            return 0.0
        try:
            return max(0.0, float(retry_after))
        except ValueError:
            return 0.0

    def _request(self, url: str, params: Dict[str, str], *, allow_404: bool = False) -> requests.Response:
        last_response: Optional[requests.Response] = None
        for attempt in range(self.max_retries):
            self._rate_limit()
            response = requests.get(url, params=params, timeout=self.timeout_s)
            last_response = response
            if allow_404 and response.status_code == 404:
                return response
            if response.status_code in {429, 503}:
                if attempt >= self.max_retries - 1:
                    raise OpenAlexRequestError(response.status_code, url)
                retry_after = self._parse_retry_after(response)
                wait_s = max(retry_after, self.backoff_base_s * (2**attempt))
                time.sleep(wait_s)
                continue
            if response.status_code >= 400:
                raise OpenAlexRequestError(response.status_code, url)
            return response
        if last_response is not None:
            raise OpenAlexRequestError(last_response.status_code, url)
        raise OpenAlexRequestError(0, url, "OpenAlex request failed without a response")

    def get_work_by_doi(self, doi: str) -> Optional[Dict[str, Any]]:
        doi = doi.lower().strip()
        if doi in self._work_by_doi_cache:
            return self._work_by_doi_cache[doi]

        url = f"{self.base_url}/works/https://doi.org/{doi}"
        response = self._request(url, params=self._params(), allow_404=True)
        if response.status_code == 404:
            self._work_by_doi_cache[doi] = None
            return None
        work = response.json()
        self._work_by_doi_cache[doi] = work
        return work

    def search_work(self, query: str, per_page: int = 5) -> Dict[str, Any]:
        cache_key = (query, per_page)
        if cache_key in self._search_cache:
            return self._search_cache[cache_key]

        response = self._request(
            f"{self.base_url}/works",
            params={**self._params(), "search": query, "per-page": str(per_page)},
        )
        payload = response.json()
        self._search_cache[cache_key] = payload
        return payload
