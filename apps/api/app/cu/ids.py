from __future__ import annotations

import hashlib
import re

PROCESS_HASH_LENGTH = 12
ANALYZER_HASH_LENGTH = 12

_HEX_CHARS = re.compile(r"[0-9a-f]")


def routing_analyzer_id(process_id: str) -> str:
    return f"idp_r_{_process_hash(process_id)}"


def derived_analyzer_id(process_id: str, source_analyzer_id: str) -> str:
    source_hash = hashlib.sha256(source_analyzer_id.encode("utf-8")).hexdigest()[
        :ANALYZER_HASH_LENGTH
    ]
    return f"idp_d_{_process_hash(process_id)}_{source_hash}"


def _process_hash(process_id: str) -> str:
    normalized = "".join(_HEX_CHARS.findall(process_id.lower()))
    if len(normalized) < PROCESS_HASH_LENGTH:
        raise ValueError("process_id must contain at least 12 hexadecimal characters")
    return normalized[:PROCESS_HASH_LENGTH]
