from __future__ import annotations

from pathlib import Path

import yaml

from app.main import build_openapi_schema, create_app

HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
REPO_ROOT = Path(__file__).resolve().parents[3]
OPENAPI_SPEC_PATH = REPO_ROOT / "docs/spec/api/openapi.yaml"


def load_handwritten_openapi() -> dict[str, object]:
    with OPENAPI_SPEC_PATH.open() as stream:
        return yaml.safe_load(stream)


def operation_set(schema: dict[str, object], path: str) -> set[str]:
    path_item = schema["paths"][path]
    assert isinstance(path_item, dict)
    return {method for method in path_item if method in HTTP_METHODS}


def security_scheme_set(schema: dict[str, object]) -> set[str]:
    components = schema.get("components") or {}
    assert isinstance(components, dict)
    security_schemes = components.get("securitySchemes") or {}
    assert isinstance(security_schemes, dict)
    return set(security_schemes)


def explicit_public_operations(schema: dict[str, object]) -> set[str]:
    public_operations: set[str] = set()
    paths = schema["paths"]
    assert isinstance(paths, dict)
    for path, path_item in paths.items():
        assert isinstance(path_item, dict)
        for method, operation in path_item.items():
            if method not in HTTP_METHODS:
                continue
            assert isinstance(operation, dict)
            if operation.get("security") == []:
                public_operations.add(f"{method.upper()} {path}")
    return public_operations


def format_path_set(paths: set[str]) -> str:
    return ", ".join(sorted(paths)) or "<none>"


def test_handwritten_openapi_tracks_live_contract_shape() -> None:
    live = build_openapi_schema(create_app())
    hand = load_handwritten_openapi()

    live_paths = set(live["paths"])
    hand_paths = set(hand["paths"])
    missing_paths = live_paths - hand_paths
    extra_paths = hand_paths - live_paths
    assert not missing_paths and not extra_paths, (
        "Path set drift detected.\n"
        f"Missing from handwritten spec: {format_path_set(missing_paths)}\n"
        f"Extra in handwritten spec: {format_path_set(extra_paths)}"
    )

    operation_mismatches: list[str] = []
    for path in sorted(live_paths & hand_paths):
        live_methods = operation_set(live, path)
        hand_methods = operation_set(hand, path)
        if live_methods != hand_methods:
            operation_mismatches.append(
                f"{path}: missing={format_path_set(live_methods - hand_methods)} "
                f"extra={format_path_set(hand_methods - live_methods)}"
            )
    assert not operation_mismatches, "Operation drift detected.\n" + "\n".join(operation_mismatches)

    live_schemes = security_scheme_set(live)
    hand_schemes = security_scheme_set(hand)
    assert live_schemes == hand_schemes, (
        "Security scheme drift detected.\n"
        f"Missing from handwritten spec: {format_path_set(live_schemes - hand_schemes)}\n"
        f"Extra in handwritten spec: {format_path_set(hand_schemes - live_schemes)}"
    )

    live_public_operations = explicit_public_operations(live)
    hand_public_operations = explicit_public_operations(hand)
    assert live_public_operations == hand_public_operations, (
        "Public-operation security drift detected.\n"
        f"Missing empty-security overrides: {format_path_set(live_public_operations - hand_public_operations)}\n"
        f"Unexpected empty-security overrides: {format_path_set(hand_public_operations - live_public_operations)}"
    )
