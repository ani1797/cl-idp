"""Tests for the Foundry AI Agent Judge: schema parsing, prompt assembly,
endpoint derivation, and worker wiring (`run_judge`) with a fake client —
no real Azure Agents calls. The live-resource validation lives in
`scripts/spikes/judge_spike.py` (see Todo 1 of the judge plan)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.config import Settings
from app.judge.client import JudgeError, project_endpoint_from_cu_endpoint
from app.judge.prompt import FlaggedField, build_user_message, collect_flagged_fields
from app.judge.schema import (
    JudgeParsingError,
    build_judge_review,
    parse_judge_findings,
)
from app.models import BooleanField, JudgeStatus, JudgeVerdict, StringField
from app.models.internal import JobDocument, JobQueueMessage
from app.worker.main import WorkerDependencies, run_judge
from app.worker.result_mapping import MappedJobResult


class FakeJudgeClient:
    def __init__(self, *, reply: str | None = None, error: Exception | None = None) -> None:
        self.reply = reply
        self.error = error
        self.calls: list[tuple[str, str]] = []

    def adjudicate(self, *, instructions: str, user_message: str) -> str:
        self.calls.append((instructions, user_message))
        if self.error is not None:
            raise self.error
        assert self.reply is not None
        return self.reply

    def close(self) -> None:
        return None


def make_job(**overrides: object) -> JobDocument:
    job_id = str(uuid4())
    now = datetime.now(UTC).replace(microsecond=0)
    defaults: dict[str, object] = {
        "id": job_id,
        "processId": "process-1",
        "correlationId": str(uuid4()),
        "fileName": "sample.pdf",
        "contentType": "application/pdf",
        "blobPath": f"process-1/{job_id}/sample.pdf",
        "status": "running",
        "submittedAt": now,
        "attempts": 1,
    }
    defaults.update(overrides)
    return JobDocument.model_validate(defaults)


def make_payload(**overrides: object) -> JobQueueMessage:
    defaults: dict[str, object] = {
        "jobId": str(uuid4()),
        "processId": "process-1",
        "correlationId": str(uuid4()),
        "blobPath": "process-1/job/sample.pdf",
        "routingAnalyzerId": "idp-route-process-1",
        "confidenceThreshold": 0.8,
        "ownerEmail": "owner@example.com",
    }
    defaults.update(overrides)
    return JobQueueMessage.model_validate(defaults)


class TestEndpointDerivation:
    def test_derives_services_ai_endpoint_from_cognitiveservices_endpoint(self) -> None:
        endpoint = project_endpoint_from_cu_endpoint(
            "https://clidpprod-foundry.cognitiveservices.azure.com/"
        )
        assert endpoint == "https://clidpprod-foundry.services.ai.azure.com/api/projects/clidpprod-project"

    def test_returns_none_for_unrelated_endpoint_shape(self) -> None:
        assert project_endpoint_from_cu_endpoint("https://example.com/") is None

    def test_returns_none_for_blank_endpoint(self) -> None:
        assert project_endpoint_from_cu_endpoint("") is None


class TestCollectFlaggedFields:
    def test_resolves_violation_paths_to_fields_in_order(self) -> None:
        fields = [
            StringField(name="email", path="email", type="string", value="a@b.com", confidence=0.6),
            BooleanField(name="flag", path="flag", type="boolean", value=True, confidence=0.5),
        ]

        flagged = collect_flagged_fields(
            fields, confidence_violations=["flag", "email"], max_fields=10
        )

        assert [field.path for field in flagged] == ["flag", "email"]
        assert flagged[0].value == "true"
        assert flagged[1].value == "a@b.com"

    def test_drops_paths_with_no_matching_field(self) -> None:
        fields = [StringField(name="email", path="email", type="string", value="a@b.com", confidence=0.6)]

        flagged = collect_flagged_fields(fields, confidence_violations=["missing"], max_fields=10)

        assert flagged == []

    def test_truncates_to_max_fields(self) -> None:
        fields = [
            StringField(name=f"f{i}", path=f"f{i}", type="string", value=str(i), confidence=0.5)
            for i in range(5)
        ]

        flagged = collect_flagged_fields(
            fields,
            confidence_violations=[f"f{i}" for i in range(5)],
            max_fields=2,
        )

        assert [field.path for field in flagged] == ["f0", "f1"]

    def test_build_user_message_includes_markdown_and_fields(self) -> None:
        message = build_user_message(
            "Some OCR text",
            [FlaggedField(path="email", label="email", type="string", value="a@b.com", confidence=0.6)],
        )

        assert "Some OCR text" in message
        assert "email" in message
        assert "a@b.com" in message


class TestParseJudgeFindings:
    def test_parses_well_formed_reply(self) -> None:
        raw = json.dumps(
            {
                "findings": [
                    {
                        "path": "email",
                        "documentValue": "a@b.com",
                        "matches": True,
                        "rationale": "matches",
                        "verdict": "ok",
                        "suggestedValue": None,
                    }
                ]
            }
        )

        findings = parse_judge_findings(raw, flagged_fields={"email": "a@b.com"})

        assert len(findings) == 1
        assert findings[0].verdict == JudgeVerdict.OK
        assert findings[0].suggestedValue is None

    def test_strips_fenced_code_block(self) -> None:
        raw = "```json\n" + json.dumps({"findings": []}) + "\n```"

        findings = parse_judge_findings(raw, flagged_fields={"email": "a@b.com"})

        assert len(findings) == 1  # backfilled as unknown
        assert findings[0].verdict == JudgeVerdict.UNKNOWN

    def test_drops_hallucinated_path(self) -> None:
        raw = json.dumps(
            {
                "findings": [
                    {
                        "path": "not-flagged",
                        "documentValue": "x",
                        "matches": True,
                        "rationale": "n/a",
                        "verdict": "ok",
                        "suggestedValue": None,
                    }
                ]
            }
        )

        findings = parse_judge_findings(raw, flagged_fields={"email": "a@b.com"})

        assert len(findings) == 1
        assert findings[0].path == "email"
        assert findings[0].verdict == JudgeVerdict.UNKNOWN

    def test_backfills_missing_flagged_path_as_unknown(self) -> None:
        raw = json.dumps({"findings": []})

        findings = parse_judge_findings(raw, flagged_fields={"email": "a@b.com", "flag": "true"})

        assert {finding.path for finding in findings} == {"email", "flag"}
        assert all(finding.verdict == JudgeVerdict.UNKNOWN for finding in findings)

    def test_fix_without_usable_value_downgrades_to_unknown(self) -> None:
        raw = json.dumps(
            {
                "findings": [
                    {
                        "path": "email",
                        "documentValue": "",
                        "matches": False,
                        "rationale": "illegible",
                        "verdict": "fix",
                        "suggestedValue": None,
                    }
                ]
            }
        )

        findings = parse_judge_findings(raw, flagged_fields={"email": "a@b.com"})

        assert findings[0].verdict == JudgeVerdict.UNKNOWN
        assert findings[0].suggestedValue is None

    def test_invalid_verdict_downgrades_to_unknown(self) -> None:
        raw = json.dumps(
            {
                "findings": [
                    {
                        "path": "email",
                        "documentValue": "a@b.com",
                        "matches": True,
                        "rationale": "matches",
                        "verdict": "maybe",
                        "suggestedValue": None,
                    }
                ]
            }
        )

        findings = parse_judge_findings(raw, flagged_fields={"email": "a@b.com"})

        assert findings[0].verdict == JudgeVerdict.UNKNOWN

    def test_raises_on_unparseable_json(self) -> None:
        with pytest.raises(JudgeParsingError):
            parse_judge_findings("not json", flagged_fields={"email": "a@b.com"})

    def test_raises_when_findings_key_missing(self) -> None:
        with pytest.raises(JudgeParsingError):
            parse_judge_findings(json.dumps({"other": []}), flagged_fields={"email": "a@b.com"})


class TestBuildJudgeReview:
    def test_rollup_is_fix_when_any_finding_is_fix(self) -> None:
        raw = json.dumps(
            {
                "findings": [
                    {
                        "path": "email",
                        "documentValue": "a@b.com",
                        "matches": True,
                        "rationale": "matches",
                        "verdict": "ok",
                        "suggestedValue": None,
                    },
                    {
                        "path": "flag",
                        "documentValue": "false",
                        "matches": False,
                        "rationale": "checkbox unchecked",
                        "verdict": "fix",
                        "suggestedValue": "false",
                    },
                ]
            }
        )

        review = build_judge_review(
            raw,
            flagged_fields={"email": "a@b.com", "flag": "true"},
            model="gpt-4.1-mini",
            evaluated_at=datetime.now(UTC),
        )

        assert review.status == JudgeStatus.COMPLETED
        assert review.recommendation == JudgeVerdict.FIX
        assert len(review.findings) == 2

    def test_unparseable_reply_yields_failed_status_with_no_findings(self) -> None:
        review = build_judge_review(
            "not json",
            flagged_fields={"email": "a@b.com"},
            model="gpt-4.1-mini",
            evaluated_at=datetime.now(UTC),
        )

        assert review.status == JudgeStatus.FAILED
        assert review.recommendation == JudgeVerdict.UNKNOWN
        assert review.findings == []
        assert review.error is not None


class TestRunJudgeWorkerWiring:
    def _dependencies(self, *, judge_client: object | None) -> WorkerDependencies:
        return WorkerDependencies(
            settings=Settings(JUDGE_MODEL_DEPLOYMENT="gpt-4.1-mini"),
            data_store=None,  # type: ignore[arg-type]
            blob=None,  # type: ignore[arg-type]
            queue=None,  # type: ignore[arg-type]
            cu_client=None,  # type: ignore[arg-type]
            judge_client=judge_client,  # type: ignore[arg-type]
        )

    def _mapped_result(self, **overrides: object) -> MappedJobResult:
        defaults: dict[str, object] = {
            "detected_form": "prebuilt-invoice",
            "detected_form_name": "Invoice",
            "unclassified": False,
            "pages": [],
            "fields": [
                StringField(name="email", path="email", type="string", value="a@b.com", confidence=0.6)
            ],
            "confidence_violations": ["email"],
            "markdown": "Plan Administrator Email: a@b.com",
        }
        defaults.update(overrides)
        return MappedJobResult(**defaults)

    def test_returns_none_when_judge_disabled(self) -> None:
        dependencies = self._dependencies(judge_client=None)

        result = run_judge(
            dependencies, job=make_job(), payload=make_payload(), mapped_result=self._mapped_result()
        )

        assert result is None

    def test_returns_none_when_no_confidence_violations(self) -> None:
        dependencies = self._dependencies(judge_client=FakeJudgeClient(reply="{}"))

        result = run_judge(
            dependencies,
            job=make_job(),
            payload=make_payload(),
            mapped_result=self._mapped_result(confidence_violations=[]),
        )

        assert result is None

    def test_returns_none_when_no_markdown_evidence(self) -> None:
        dependencies = self._dependencies(judge_client=FakeJudgeClient(reply="{}"))

        result = run_judge(
            dependencies,
            job=make_job(),
            payload=make_payload(),
            mapped_result=self._mapped_result(markdown=None),
        )

        assert result is None

    def test_persists_completed_review_on_success(self) -> None:
        reply = json.dumps(
            {
                "findings": [
                    {
                        "path": "email",
                        "documentValue": "a@b.com",
                        "matches": True,
                        "rationale": "matches",
                        "verdict": "ok",
                        "suggestedValue": None,
                    }
                ]
            }
        )
        fake_client = FakeJudgeClient(reply=reply)
        dependencies = self._dependencies(judge_client=fake_client)

        review = run_judge(
            dependencies, job=make_job(), payload=make_payload(), mapped_result=self._mapped_result()
        )

        assert review is not None
        assert review.status == JudgeStatus.COMPLETED
        assert review.recommendation == JudgeVerdict.OK
        assert len(fake_client.calls) == 1

    def test_returns_failed_review_without_raising_on_judge_error(self) -> None:
        fake_client = FakeJudgeClient(error=JudgeError("boom"))
        dependencies = self._dependencies(judge_client=fake_client)

        review = run_judge(
            dependencies, job=make_job(), payload=make_payload(), mapped_result=self._mapped_result()
        )

        assert review is not None
        assert review.status == JudgeStatus.FAILED
        assert review.recommendation == JudgeVerdict.UNKNOWN
        assert review.error == "boom"
