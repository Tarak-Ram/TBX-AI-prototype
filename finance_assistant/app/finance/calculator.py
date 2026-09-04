import time
import uuid
from typing import Any
import pandas as pd
from app.core.exceptions import QueryExecutionError
from app.core.logging import logger
from app.data.dataset_manager import dataset_manager
from app.data.duckdb import duckdb_manager
from app.finance.schemas import ExecutionResult, QueryPlan

class FinancialCalculator:
    """Executes planned parameterized queries deterministically on DuckDB."""

    @classmethod
    def execute(cls, plan: QueryPlan) -> ExecutionResult:
        ds_meta, active_version = dataset_manager.get_active_dataset()
        if not active_version:
            raise QueryExecutionError("No active dataset available for computation.")

        start_time = time.time()
        query_id = f"Q-{uuid.uuid4().hex[:8].upper()}"

        df = duckdb_manager.execute_query(plan.sql, plan.parameters)
        elapsed_ms = round((time.time() - start_time) * 1000, 2)

        # Process results
        result_dict: dict[str, Any] = {}
        breakdown_list: list[dict[str, Any]] = []
        record_count = 0

        if plan.template_name in ["TOTAL_SPEND", "VENDOR_PAYOUT_SUM", "UNRECONCILED_AMOUNT", "RECONCILIATION_SUMMARY"]:
            if not df.empty:
                val = float(df.iloc[0]["total_amount"]) if "total_amount" in df.columns else 0.0
                record_count = int(df.iloc[0]["record_count"]) if "record_count" in df.columns else len(df)
                result_dict["amount"] = val
                result_dict["record_count"] = record_count
            else:
                result_dict["amount"] = 0.0
                result_dict["record_count"] = 0

        elif plan.template_name == "TRANSACTION_COUNT":
            total_count = int(df.iloc[0]["total_count"]) if not df.empty else 0
            result_dict["count"] = total_count
            record_count = total_count

        elif plan.template_name in ["VENDOR_RANKING", "CATEGORY_SPEND"]:
            if "category" in df.columns and "vendor" not in df.columns and len(df) == 1 and plan.filters_applied.get("category"):
                # Single category sum
                val = float(df.iloc[0]["total_amount"])
                record_count = int(df.iloc[0]["record_count"])
                result_dict["amount"] = val
                result_dict["record_count"] = record_count
            else:
                # Ranking or list
                breakdown_list = df.to_dict(orient="records")
                if breakdown_list:
                    top = breakdown_list[0]
                    result_dict["top_entity"] = top.get("vendor") or top.get("category")
                    result_dict["top_amount"] = top.get("total_amount")
                    record_count = sum(r.get("record_count", 0) for r in breakdown_list)
                    result_dict["record_count"] = record_count

        elif plan.template_name == "MONTHLY_PAYOUT":
            breakdown_list = df.to_dict(orient="records")
            record_count = sum(r.get("record_count", 0) for r in breakdown_list)
            result_dict["months"] = len(breakdown_list)
            result_dict["record_count"] = record_count

        elif plan.template_name == "TRANSACTION_LIST":
            breakdown_list = df.head(50).to_dict(orient="records")
            record_count = len(df)
            result_dict["record_count"] = record_count
            if "amount" in df.columns:
                result_dict["amount"] = float(df["amount"].sum())

        # Fetch supporting evidence sample (top 20 matching records)
        evidence_df = cls._fetch_supporting_evidence(plan.filters_applied)
        supporting_records = evidence_df.head(25).to_dict(orient="records")

        return ExecutionResult(
            query_id=query_id,
            dataset_id=active_version.dataset_id,
            dataset_version=active_version.dataset_version,
            filters=plan.filters_applied,
            row_count=record_count,
            calculation={
                "operation": plan.aggregation_operation,
                "field": plan.target_metric,
                "formula": plan.calculation_desc,
            },
            result=result_dict,
            breakdown=breakdown_list,
            supporting_records=supporting_records,
            execution_time_ms=elapsed_ms,
        )

    @classmethod
    def _fetch_supporting_evidence(cls, filters: dict[str, Any]) -> pd.DataFrame:
        clauses = ["1=1"]
        params = []
        if filters.get("vendor"):
            clauses.append("LOWER(vendor) = LOWER(?)")
            params.append(filters["vendor"])
        if filters.get("category"):
            clauses.append("LOWER(category) = LOWER(?)")
            params.append(filters["category"])
        if filters.get("start_date") and filters.get("end_date"):
            clauses.append("transaction_date >= ? AND transaction_date < ?")
            params.extend([filters["start_date"], filters["end_date"]])

        where_str = " AND ".join(clauses)
        sql = f"SELECT * FROM active_dataset WHERE {where_str} ORDER BY transaction_date DESC NULLS LAST LIMIT 50"
        return duckdb_manager.execute_query(sql, params)
