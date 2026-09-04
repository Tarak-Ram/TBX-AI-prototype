from app.finance.evidence import EvidenceManager
from app.finance.schemas import ExecutionResult

def test_grounding_evidence_traceability():
    execution = ExecutionResult(
        query_id="Q-GROUND-1",
        dataset_id="finance_test",
        dataset_version=2,
        filters={"vendor": "Acme Corp"},
        row_count=5,
        calculation={"formula": "SUM(amount)"},
        result={"amount": 5000.0},
        supporting_records=[{"vendor": "Acme Corp", "amount": 1000.0}],
    )
    evidence = EvidenceManager.create_evidence(execution)
    retrieved = EvidenceManager.get_evidence("Q-GROUND-1")
    assert retrieved is not None
    assert retrieved.dataset_version == 2
    assert retrieved.filters["vendor"] == "Acme Corp"
    assert len(retrieved.supporting_records) == 1
