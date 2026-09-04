import io
import pandas as pd
from app.core.exceptions import FinanceAssistantException
from app.finance.evidence import EvidenceManager

class ExcelExporter:
    """Exports verified evidence records to Excel (.xlsx) format using openpyxl."""

    @staticmethod
    def export_evidence_to_excel(query_id: str) -> bytes:
        evidence = EvidenceManager.get_evidence(query_id)
        if not evidence:
            raise FinanceAssistantException(f"No evidence records found for Query ID '{query_id}'.")

        records = evidence.supporting_records
        if not records:
            records = [{"query_id": query_id, "result": str(evidence.result), "records": evidence.row_count}]

        df = pd.DataFrame(records)
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Evidence", index=False)
            
            # Summary sheet
            summary_data = [
                {"Attribute": "Query ID", "Value": query_id},
                {"Attribute": "Dataset Version", "Value": evidence.dataset_version},
                {"Attribute": "Period", "Value": str(evidence.period)},
                {"Attribute": "Row Count", "Value": evidence.row_count},
                {"Attribute": "Calculation", "Value": str(evidence.calculation.get("formula"))},
                {"Attribute": "Result", "Value": str(evidence.result)},
            ]
            pd.DataFrame(summary_data).to_excel(writer, sheet_name="Audit Summary", index=False)

        return output.getvalue()
