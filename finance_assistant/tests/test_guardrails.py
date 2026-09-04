import pytest
from app.finance.schemas import ExecutionResult
from app.finance.validator import FinalResponseGuardrail
from app.core.exceptions import GuardrailViolationError

def test_guardrail_allows_grounded_numbers():
    exec_res = ExecutionResult(
        query_id="Q-TEST",
        dataset_id="finance",
        dataset_version=1,
        row_count=842,
        result={"amount": 12431882.0},
        breakdown=[],
        supporting_records=[],
    )
    # Grounded text using ₹12.43M and 842
    valid_text = "Vendor payouts totaled \xe2\x82\xb912.43M across 842 payouts in August 2026."
    assert FinalResponseGuardrail.verify_response(valid_text, exec_res) is True

def test_guardrail_rejects_hallucinated_numbers():
    exec_res = ExecutionResult(
        query_id="Q-TEST",
        dataset_id="finance",
        dataset_version=1,
        row_count=842,
        result={"amount": 12431882.0},
        breakdown=[],
        supporting_records=[],
    )
    # 99.99M is invented/hallucinated
    hallucinated_text = "Vendor payouts totaled \xe2\x82\xb999.99M across 842 payouts."
    with pytest.raises(GuardrailViolationError):
        FinalResponseGuardrail.verify_response(hallucinated_text, exec_res)
