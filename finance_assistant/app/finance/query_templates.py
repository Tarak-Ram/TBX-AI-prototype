from typing import Any
from pydantic import BaseModel

class ParameterizedQuery(BaseModel):
    sql: str
    params: list[Any]
    template_name: str
    calculation_desc: str
    target_metric: str

class QueryTemplates:
    """Approved, parameterized SQL templates for deterministic financial execution."""

    @staticmethod
    def total_spend(start_date: str | None = None, end_date: str | None = None) -> ParameterizedQuery:
        where_clauses = ["amount IS NOT NULL"]
        params = []
        if start_date and end_date:
            where_clauses.append("transaction_date >= ? AND transaction_date < ?")
            params.extend([start_date, end_date])
        where_sql = " AND ".join(where_clauses)
        sql = f"""
            SELECT 
                COALESCE(SUM(amount), 0) AS total_amount,
                COUNT(*) AS record_count
            FROM active_dataset
            WHERE {where_sql}
        """
        return ParameterizedQuery(
            sql=sql,
            params=params,
            template_name="TOTAL_SPEND",
            calculation_desc="SUM(amount)",
            target_metric="amount",
        )

    @staticmethod
    def vendor_payout_sum(vendor: str, start_date: str | None = None, end_date: str | None = None) -> ParameterizedQuery:
        where_clauses = ["amount IS NOT NULL", "LOWER(vendor) = LOWER(?)"]
        params = [vendor]
        if start_date and end_date:
            where_clauses.append("transaction_date >= ? AND transaction_date < ?")
            params.extend([start_date, end_date])
        where_sql = " AND ".join(where_clauses)
        sql = f"""
            SELECT 
                COALESCE(SUM(amount), 0) AS total_amount,
                COUNT(*) AS record_count
            FROM active_dataset
            WHERE {where_sql}
        """
        return ParameterizedQuery(
            sql=sql,
            params=params,
            template_name="VENDOR_PAYOUT_SUM",
            calculation_desc="SUM(amount)",
            target_metric="amount",
        )

    @staticmethod
    def vendor_ranking(limit: int = 5, start_date: str | None = None, end_date: str | None = None) -> ParameterizedQuery:
        where_clauses = ["amount IS NOT NULL", "vendor IS NOT NULL"]
        params = []
        if start_date and end_date:
            where_clauses.append("transaction_date >= ? AND transaction_date < ?")
            params.extend([start_date, end_date])
        params.append(limit)
        where_sql = " AND ".join(where_clauses)
        sql = f"""
            SELECT 
                vendor,
                COALESCE(SUM(amount), 0) AS total_amount,
                COUNT(*) AS record_count
            FROM active_dataset
            WHERE {where_sql}
            GROUP BY vendor
            ORDER BY total_amount DESC
            LIMIT ?
        """
        return ParameterizedQuery(
            sql=sql,
            params=params,
            template_name="VENDOR_RANKING",
            calculation_desc="SUM(amount) GROUP BY vendor ORDER BY total_amount DESC",
            target_metric="amount",
        )

    @staticmethod
    def category_spend(category: str | None = None, start_date: str | None = None, end_date: str | None = None, limit: int = 10) -> ParameterizedQuery:
        where_clauses = ["amount IS NOT NULL"]
        params = []
        if category:
            where_clauses.append("LOWER(category) = LOWER(?)")
            params.append(category)
        if start_date and end_date:
            where_clauses.append("transaction_date >= ? AND transaction_date < ?")
            params.extend([start_date, end_date])

        where_sql = " AND ".join(where_clauses)
        if category:
            sql = f"""
                SELECT 
                    COALESCE(SUM(amount), 0) AS total_amount,
                    COUNT(*) AS record_count
                FROM active_dataset
                WHERE {where_sql}
            """
            calc = "SUM(amount)"
        else:
            params.append(limit)
            sql = f"""
                SELECT 
                    category,
                    COALESCE(SUM(amount), 0) AS total_amount,
                    COUNT(*) AS record_count
                FROM active_dataset
                WHERE {where_sql} AND category IS NOT NULL
                GROUP BY category
                ORDER BY total_amount DESC
                LIMIT ?
            """
            calc = "SUM(amount) GROUP BY category ORDER BY total_amount DESC"

        return ParameterizedQuery(
            sql=sql,
            params=params,
            template_name="CATEGORY_SPEND",
            calculation_desc=calc,
            target_metric="amount",
        )

    @staticmethod
    def transaction_count(vendor: str | None = None, start_date: str | None = None, end_date: str | None = None) -> ParameterizedQuery:
        where_clauses = ["1=1"]
        params = []
        if vendor:
            where_clauses.append("LOWER(vendor) = LOWER(?)")
            params.append(vendor)
        if start_date and end_date:
            where_clauses.append("transaction_date >= ? AND transaction_date < ?")
            params.extend([start_date, end_date])
        where_sql = " AND ".join(where_clauses)
        sql = f"""
            SELECT COUNT(*) AS total_count
            FROM active_dataset
            WHERE {where_sql}
        """
        return ParameterizedQuery(
            sql=sql,
            params=params,
            template_name="TRANSACTION_COUNT",
            calculation_desc="COUNT(*)",
            target_metric="transaction_count",
        )

    @staticmethod
    def reconciliation_query(is_unreconciled_only: bool = True, start_date: str | None = None, end_date: str | None = None) -> ParameterizedQuery:
        where_clauses = ["amount IS NOT NULL"]
        params = []
        if is_unreconciled_only:
            where_clauses.append("(LOWER(status) LIKE '%unrecon%' OR LOWER(status) LIKE '%pending%' OR LOWER(status) LIKE '%failed%' OR LOWER(status) = 'open')")
        if start_date and end_date:
            where_clauses.append("transaction_date >= ? AND transaction_date < ?")
            params.extend([start_date, end_date])
        where_sql = " AND ".join(where_clauses)
        sql = f"""
            SELECT 
                COALESCE(SUM(amount), 0) AS total_amount,
                COUNT(*) AS record_count
            FROM active_dataset
            WHERE {where_sql}
        """
        return ParameterizedQuery(
            sql=sql,
            params=params,
            template_name="UNRECONCILED_AMOUNT" if is_unreconciled_only else "RECONCILIATION_SUMMARY",
            calculation_desc="SUM(amount) FILTER (status in unreconciled)",
            target_metric="amount",
        )

    @staticmethod
    def transaction_list(
        vendor: str | None = None,
        category: str | None = None,
        status: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int = 50
    ) -> ParameterizedQuery:
        where_clauses = ["1=1"]
        params = []
        if vendor:
            where_clauses.append("LOWER(vendor) = LOWER(?)")
            params.append(vendor)
        if category:
            where_clauses.append("LOWER(category) = LOWER(?)")
            params.append(category)
        if status:
            where_clauses.append("LOWER(status) = LOWER(?)")
            params.append(status)
        if start_date and end_date:
            where_clauses.append("transaction_date >= ? AND transaction_date < ?")
            params.extend([start_date, end_date])
        params.append(limit)
        where_sql = " AND ".join(where_clauses)
        sql = f"""
            SELECT *
            FROM active_dataset
            WHERE {where_sql}
            ORDER BY transaction_date DESC NULLS LAST
            LIMIT ?
        """
        return ParameterizedQuery(
            sql=sql,
            params=params,
            template_name="TRANSACTION_LIST",
            calculation_desc="SELECT * LIMIT",
            target_metric="records",
        )

    @staticmethod
    def monthly_payout(vendor: str | None = None, limit: int = 12) -> ParameterizedQuery:
        where_clauses = ["amount IS NOT NULL", "transaction_date IS NOT NULL"]
        params = []
        if vendor:
            where_clauses.append("LOWER(vendor) = LOWER(?)")
            params.append(vendor)
        params.append(limit)
        where_sql = " AND ".join(where_clauses)
        sql = f"""
            SELECT 
                STRFTIME(CAST(transaction_date AS DATE), '%Y-%m') AS month,
                COALESCE(SUM(amount), 0) AS total_amount,
                COUNT(*) AS record_count
            FROM active_dataset
            WHERE {where_sql}
            GROUP BY month
            ORDER BY month DESC
            LIMIT ?
        """
        return ParameterizedQuery(
            sql=sql,
            params=params,
            template_name="MONTHLY_PAYOUT",
            calculation_desc="SUM(amount) GROUP BY STRFTIME(transaction_date, '%Y-%m')",
            target_metric="amount",
        )
