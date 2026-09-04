from app.finance.evidence import EvidenceManager
from app.finance.schemas import ExecutionResult
from app.export.csv import CSVExporter
from app.export.excel import ExcelExporter

def test_evidence_export_roundtrip():
    execution = ExecutionResult(
        query_id="Q-EXP-1",
        dataset_id="test_ds",
        dataset_version=1,
        row_count=1,
        result={"amount": 1200.0},
        supporting_records=[{"vendor": "Acme", "amount": 1200.0, "status": "Paid"}],
    )
    EvidenceManager.create_evidence(execution)
    csv_bytes = CSVExporter.export_evidence_to_csv("Q-EXP-1")
    assert b"Acme" in csv_bytes
    assert b"1200.0" in csv_bytes

    excel_bytes = ExcelExporter.export_evidence_to_excel("Q-EXP-1")
    assert len(excel_bytes) > 100
