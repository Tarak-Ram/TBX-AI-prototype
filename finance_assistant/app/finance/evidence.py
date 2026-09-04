from app.data.dataset_manager import dataset_manager
from app.data.duckdb import duckdb_manager
from app.finance.schemas import Evidence, ExecutionResult

class EvidenceManager:
    """Stores, formats, and indexes audit evidence generated during query execution."""

    _evidence_store: dict[str, Evidence] = {}

    @classmethod
    def create_evidence(cls, execution: ExecutionResult) -> Evidence:
        total_in_dataset = duckdb_manager.get_row_count("active_dataset")
        period_str = execution.filters.get("period")
        if not period_str and execution.filters.get("start_date") and execution.filters.get("end_date"):
            period_str = f"{execution.filters['start_date']} to {execution.filters['end_date']}"

        ev = Evidence(
            query_id=execution.query_id,
            dataset_version=execution.dataset_version,
            period=period_str,
            filters=execution.filters,
            row_count=execution.row_count,
            calculation=execution.calculation,
            result=execution.result,
            supporting_records=execution.supporting_records,
            total_records_in_dataset=total_in_dataset,
        )

        cls._evidence_store[execution.query_id] = ev
        return ev

    @classmethod
    def get_evidence(cls, query_id: str) -> Evidence | None:
        return cls._evidence_store.get(query_id)
