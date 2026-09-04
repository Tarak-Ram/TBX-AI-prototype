import io
import pandas as pd
from app.core.exceptions import FinanceAssistantException
from app.finance.evidence import EvidenceManager

class CSVExporter:
    """Exports verified evidence records to CSV format."""

    @staticmethod
    def export_evidence_to_csv(query_id: str) -> bytes:
        evidence = EvidenceManager.get_evidence(query_id)
        if not evidence:
            raise FinanceAssistantException(f"No evidence records found for Query ID '{query_id}'.")

        records = evidence.supporting_records
        if not records:
            # If no supporting records in evidence, create summary row
            records = [{"query_id": query_id, "result": str(evidence.result), "records": evidence.row_count}]

        df = pd.DataFrame(records)
        output = io.StringIO()
        df.to_csv(output, index=False)
        return output.getvalue().encode("utf-8")
