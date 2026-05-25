"""Post pipeline JSON payload to /api/cite/bulk-ingest."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Post pipeline payload to cite bulk-ingest endpoint.")
    parser.add_argument("--payload", required=True, help="Path to payload JSON file")
    parser.add_argument("--api-url", help="Bulk ingest endpoint URL (default: SP_INGEST_API_URL)")
    parser.add_argument("--token", help="COLAB ingest token (default: SP_INGEST_TOKEN)")
    parser.add_argument("--timeout", type=int, default=120, help="HTTP timeout in seconds")
    return parser.parse_args()


def load_payload(payload_path: str) -> Dict[str, Any]:
    raw = Path(payload_path).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    return payload


def post_payload(api_url: str, token: str, payload: Dict[str, Any], timeout: int) -> requests.Response:
    return requests.post(
        api_url,
        headers={
            "Authorization": f"Bearer {token}",
            "x-ingest-token": token,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )


def main() -> None:
    args = parse_args()
    api_url = args.api_url or os.getenv("SP_INGEST_API_URL", "http://localhost:8787/api/cite/bulk-ingest")
    token = args.token or os.getenv("SP_INGEST_TOKEN")
    if not token:
        raise SystemExit("SP_INGEST_TOKEN or --token is required")

    payload = load_payload(args.payload)
    response = post_payload(api_url, token, payload, args.timeout)
    response.raise_for_status()
    print(response.text)


if __name__ == "__main__":
    main()
