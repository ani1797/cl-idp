from __future__ import annotations

import hashlib

import pytest

from app.cu import derived_analyzer_id, routing_analyzer_id


def test_routing_analyzer_id_uses_first_twelve_hex_chars_of_process_id() -> None:
    assert routing_analyzer_id("550E8400-e29b-41d4-a716-446655440000") == "idp_r_550e8400e29b"


def test_derived_analyzer_id_uses_process_hash_and_source_hash() -> None:
    expected_source_hash = hashlib.sha256(b"prebuilt-invoice").hexdigest()[:12]

    assert (
        derived_analyzer_id(
            "550e8400-e29b-41d4-a716-446655440000",
            "prebuilt-invoice",
        )
        == f"idp_d_550e8400e29b_{expected_source_hash}"
    )


def test_generated_ids_use_only_allowed_characters_and_stay_bounded() -> None:
    routing_id = routing_analyzer_id("550e8400-e29b-41d4-a716-446655440000")
    derived_id = derived_analyzer_id("550e8400-e29b-41d4-a716-446655440000", "custom-analyzer")

    assert routing_id.replace("_", "").isalnum()
    assert derived_id.replace("_", "").isalnum()
    assert "-" not in routing_id
    assert "-" not in derived_id
    assert len(routing_id) == 18
    assert len(derived_id) == 31


def test_routing_analyzer_id_requires_twelve_hex_characters() -> None:
    with pytest.raises(ValueError, match="at least 12 hexadecimal characters"):
        routing_analyzer_id("process-xyz")
