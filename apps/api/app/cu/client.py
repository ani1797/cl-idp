from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from azure.ai.contentunderstanding import ContentUnderstandingClient
from azure.core.credentials import AccessToken, AzureKeyCredential
from azure.core.exceptions import AzureError, HttpResponseError
from azure.identity import DefaultAzureCredential

from app.config import Settings

API_VERSION = "2025-11-01"
COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"
CREATED_BY_TAG = "cl-idp"


class ContentUnderstandingError(RuntimeError):
    pass


class CuApiError(ContentUnderstandingError):
    def __init__(
        self,
        *,
        status_code: int,
        code: str | None,
        message: str,
        body: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.body = body


class UnknownAnalyzerError(LookupError):
    def __init__(self, analyzer_id: str) -> None:
        super().__init__(f"Unknown analyzer ID: {analyzer_id}")
        self.analyzer_id = analyzer_id


@dataclass(frozen=True)
class CuAnalyzerRecord:
    analyzer_id: str
    name: str
    description: str | None
    tags: dict[str, str]
    status: str | None = None
    base_analyzer_id: str | None = None
    config: dict[str, Any] | None = None
    models: dict[str, str] | None = None


class CuClient:
    def __init__(self, settings: Settings) -> None:
        self._endpoint = settings.cu_endpoint.rstrip("/")
        self._api_key = settings.cu_api_key or None
        self._configured_model_deployment = settings.cu_model_deployment or None
        self._credential = (
            None
            if self._api_key
            else DefaultAzureCredential(exclude_interactive_browser_credential=True)
        )
        sdk_credential = (
            AzureKeyCredential(self._api_key) if self._api_key else self._require_credential()
        )
        self._sdk_client = ContentUnderstandingClient(
            endpoint=self._require_endpoint(),
            credential=sdk_credential,
            api_version=API_VERSION,
        )
        self._http = httpx.Client(timeout=120)

    def close(self) -> None:
        self._sdk_client.close()
        self._http.close()
        if self._credential is not None:
            self._credential.close()

    def list_analyzers(self) -> list[CuAnalyzerRecord]:
        try:
            return [self._parse_analyzer_record(item) for item in self._sdk_client.list_analyzers()]
        except AzureError:
            analyzers: list[CuAnalyzerRecord] = []
            next_url: str | None = self._url_for("/contentunderstanding/analyzers")
            while next_url:
                page = self._request_json("GET", next_url, absolute_url=True)
                page_items = page.get("value")
                if not isinstance(page_items, list):
                    raise ContentUnderstandingError(
                        "CU analyzer list response was missing 'value'."
                    )
                analyzers.extend(self._parse_analyzer_record(item) for item in page_items)
                next_link = page.get("nextLink")
                next_url = next_link if isinstance(next_link, str) and next_link else None
            return analyzers

    def get_analyzer(self, analyzer_id: str) -> CuAnalyzerRecord:
        try:
            return self._parse_analyzer_record(self._sdk_client.get_analyzer(analyzer_id))
        except HttpResponseError as exc:
            if exc.status_code == 404:
                raise UnknownAnalyzerError(analyzer_id) from exc
        except AzureError:
            pass

        body = self._request_json(
            "GET",
            f"/contentunderstanding/analyzers/{analyzer_id}",
        )
        return self._parse_analyzer_record(body)

    def create_or_replace_analyzer(
        self,
        analyzer_id: str,
        payload: dict[str, Any],
    ) -> CuAnalyzerRecord:
        body = self._request_json(
            "PUT",
            f"/contentunderstanding/analyzers/{analyzer_id}",
            params={"allowReplace": "true"},
            json_body=payload,
        )
        return self._parse_analyzer_record(body)

    def delete_analyzer(self, analyzer_id: str) -> None:
        try:
            self._request(
                "DELETE",
                f"/contentunderstanding/analyzers/{analyzer_id}",
            )
        except CuApiError as exc:
            if exc.status_code == 404:
                return
            raise

    def wait_for_analyzer_terminal_status(
        self,
        analyzer_id: str,
        *,
        poll_interval_seconds: float = 2,
        timeout_seconds: float = 180,
    ) -> CuAnalyzerRecord:
        deadline = time.monotonic() + timeout_seconds
        while True:
            analyzer = self.get_analyzer(analyzer_id)
            if analyzer.status in {"ready", "failed"}:
                return analyzer
            if time.monotonic() >= deadline:
                raise ContentUnderstandingError(
                    f"Timed out waiting for analyzer {analyzer_id} to reach a terminal status."
                )
            time.sleep(poll_interval_seconds)

    def get_defaults(self) -> dict[str, Any]:
        try:
            defaults = self._sdk_client.get_defaults()
            if hasattr(defaults, "as_dict"):
                return defaults.as_dict()
            if isinstance(defaults, dict):
                return defaults
            raise ContentUnderstandingError("CU defaults response had an unexpected type.")
        except AzureError:
            body = self._request_json("GET", "/contentunderstanding/defaults")
            return body

    def resolve_completion_model_name(self) -> str:
        defaults = self.get_defaults()
        raw_model_deployments = defaults.get("modelDeployments")
        if not isinstance(raw_model_deployments, dict) or not raw_model_deployments:
            raise ContentUnderstandingError(
                "No completion model mapping was available from Content Understanding defaults."
            )

        model_deployments = {
            key: value
            for key, value in raw_model_deployments.items()
            if isinstance(key, str) and isinstance(value, str)
        }
        if not model_deployments:
            raise ContentUnderstandingError(
                "No valid completion model mapping was available from Content Understanding defaults."
            )

        preferred_models = [
            key for key in model_deployments if not key.startswith("prebuilt-")
        ]
        if self._configured_model_deployment:
            matching_models = [
                key
                for key, value in model_deployments.items()
                if value == self._configured_model_deployment
            ]
            if "gpt-5-mini" in matching_models:
                return "gpt-5-mini"
            if matching_models:
                for match in matching_models:
                    if not match.startswith("prebuilt-"):
                        return match
                return matching_models[0]
        if "gpt-5-mini" in model_deployments:
            return "gpt-5-mini"
        if preferred_models:
            return preferred_models[0]
        return next(iter(model_deployments))

    def analyze_binary(
        self,
        analyzer_id: str,
        content: bytes,
        *,
        content_type: str = "application/octet-stream",
    ) -> str:
        response = self._request(
            "POST",
            f"/contentunderstanding/analyzers/{analyzer_id}:analyzeBinary",
            content_body=content,
            content_type=content_type,
        )
        operation_location = response.headers.get("Operation-Location")
        if not operation_location:
            raise ContentUnderstandingError(
                "Content Understanding analyzeBinary response was missing Operation-Location."
            )
        operation_id = self._operation_id_from_location(operation_location)
        if not operation_id:
            raise ContentUnderstandingError(
                "Content Understanding analyzeBinary response returned an invalid Operation-Location."
            )
        return operation_id

    def get_analyzer_result(self, operation_id: str) -> dict[str, Any]:
        return self._request_json(
            "GET",
            f"/contentunderstanding/analyzerResults/{operation_id}",
        )

    def _parse_analyzer_record(self, item: Any) -> CuAnalyzerRecord:
        analyzer_id = self._read_string(item, "analyzer_id", "analyzerId")
        if not analyzer_id:
            raise ContentUnderstandingError("CU analyzer entry was missing 'analyzerId'.")

        raw_tags = self._read_value(item, "tags", "tags")
        tags = raw_tags if isinstance(raw_tags, dict) else {}
        normalized_tags = {
            key: value
            for key, value in tags.items()
            if isinstance(key, str) and isinstance(value, str)
        }

        raw_name = (
            self._read_string(item, "display_name", "displayName")
            or self._read_string(item, "name", "name")
            or analyzer_id
        )
        description = self._read_string(item, "description", "description")
        status = self._normalize_string(self._read_value(item, "status", "status"))
        base_analyzer_id = self._read_string(item, "base_analyzer_id", "baseAnalyzerId")
        config = self._read_mapping(item, "config", "config")
        models = self._read_string_mapping(item, "models", "models")

        return CuAnalyzerRecord(
            analyzer_id=analyzer_id,
            name=raw_name,
            description=description,
            tags=normalized_tags,
            status=status,
            base_analyzer_id=base_analyzer_id,
            config=config,
            models=models,
        )

    def _request_json(
        self,
        method: str,
        path_or_url: str,
        *,
        absolute_url: bool = False,
        params: dict[str, str] | None = None,
        json_body: Any | None = None,
        content_body: bytes | None = None,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        response = self._request(
            method,
            path_or_url,
            absolute_url=absolute_url,
            params=params,
            json_body=json_body,
            content_body=content_body,
            content_type=content_type,
        )
        try:
            body = response.json()
        except json.JSONDecodeError as exc:
            raise ContentUnderstandingError("Content Understanding returned invalid JSON.") from exc

        if not isinstance(body, dict):
            raise ContentUnderstandingError("Content Understanding returned a non-object response.")
        return body

    def _request(
        self,
        method: str,
        path_or_url: str,
        *,
        absolute_url: bool = False,
        params: dict[str, str] | None = None,
        json_body: Any | None = None,
        content_body: bytes | None = None,
        content_type: str | None = None,
    ) -> httpx.Response:
        url = path_or_url if absolute_url else self._url_for(path_or_url, params=params)
        if absolute_url and params:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}{urlencode(params)}"
        headers = self._headers()
        if content_type is not None:
            headers["Content-Type"] = content_type

        try:
            response = self._http.request(
                method=method,
                url=url,
                headers=headers,
                json=json_body,
                content=content_body,
            )
        except (ValueError, httpx.HTTPError) as exc:
            raise ContentUnderstandingError("Content Understanding request failed.") from exc

        if response.is_error:
            raise self._error_from_response(response)
        return response

    def _error_from_response(self, response: httpx.Response) -> CuApiError:
        body: Any | None = None
        code: str | None = None
        message = f"Content Understanding request failed with HTTP {response.status_code}."
        try:
            body = response.json()
        except json.JSONDecodeError:
            body = response.text or None
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict):
                resolved_code, resolved_message = self._extract_error_details(error)
                if resolved_code is not None:
                    code = resolved_code
                if resolved_message is not None:
                    message = resolved_message
            else:
                raw_message = body.get("message")
                if isinstance(raw_message, str) and raw_message:
                    message = raw_message
        elif isinstance(body, str) and body:
            message = body

        return CuApiError(
            status_code=response.status_code,
            code=code,
            message=message,
            body=body,
        )

    @classmethod
    def _extract_error_details(cls, error: dict[str, Any]) -> tuple[str | None, str | None]:
        code = error.get("code") if isinstance(error.get("code"), str) else None
        message = error.get("message") if isinstance(error.get("message"), str) else None

        inner_error = error.get("innererror")
        if isinstance(inner_error, dict):
            inner_code, inner_message = cls._extract_error_details(inner_error)
            if inner_code is not None:
                code = inner_code
            if inner_message is not None:
                message = inner_message

        details = error.get("details")
        if isinstance(details, list):
            for detail in details:
                if not isinstance(detail, dict):
                    continue
                detail_code, detail_message = cls._extract_error_details(detail)
                if detail_code is not None:
                    code = detail_code
                if detail_message is not None:
                    message = detail_message

        return code, message

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self._api_key:
            headers["Ocp-Apim-Subscription-Key"] = self._api_key
            return headers

        token = self._get_access_token()
        headers["Authorization"] = "Bearer " + token.token
        return headers

    def _get_access_token(self) -> AccessToken:
        credential = self._require_credential()
        return credential.get_token(COGNITIVE_SERVICES_SCOPE)

    def _url_for(self, path: str, *, params: dict[str, str] | None = None) -> str:
        query_params = {"api-version": API_VERSION}
        if params:
            query_params.update(params)
        return f"{self._require_endpoint()}{path}?{urlencode(query_params)}"

    @staticmethod
    def _operation_id_from_location(operation_location: str) -> str | None:
        parsed = urlparse(operation_location)
        path = parsed.path.rstrip("/")
        if not path:
            return None
        operation_id = path.rsplit("/", 1)[-1]
        return operation_id or None

    @staticmethod
    def _read_value(item: Any, attr_name: str, key_name: str) -> Any | None:
        if isinstance(item, dict):
            return item.get(key_name)
        return getattr(item, attr_name, None)

    @classmethod
    def _read_string(cls, item: Any, attr_name: str, key_name: str) -> str | None:
        value = cls._read_value(item, attr_name, key_name)
        normalized = cls._normalize_string(value)
        return normalized

    @classmethod
    def _normalize_string(cls, value: Any | None) -> str | None:
        if value is None:
            return None
        raw = getattr(value, "value", value)
        return raw if isinstance(raw, str) and raw else None

    @staticmethod
    def _read_mapping(item: Any, attr_name: str, key_name: str) -> dict[str, Any] | None:
        value = CuClient._read_value(item, attr_name, key_name)
        if value is None:
            return None
        if isinstance(value, dict):
            return value
        if hasattr(value, "as_dict"):
            rendered = value.as_dict()
            return rendered if isinstance(rendered, dict) else None
        return None

    @classmethod
    def _read_string_mapping(
        cls,
        item: Any,
        attr_name: str,
        key_name: str,
    ) -> dict[str, str] | None:
        mapping = cls._read_mapping(item, attr_name, key_name)
        if mapping is None:
            return None
        return {
            key: value
            for key, value in mapping.items()
            if isinstance(key, str) and isinstance(value, str)
        }

    def _require_endpoint(self) -> str:
        if not self._endpoint:
            raise ContentUnderstandingError("CU_ENDPOINT is not configured.")
        return self._endpoint

    def _require_credential(self) -> DefaultAzureCredential:
        if self._credential is None:
            raise ContentUnderstandingError("No Content Understanding credential is available.")
        return self._credential
