from typing import Any
import pandas as pd
from app.data.dataset_manager import dataset_manager
from app.data.duckdb import duckdb_manager

class FinanceRepository:
    """Provides high-level queries and data retrieval from the active financial dataset."""

    @staticmethod
    def get_vendors() -> list[str]:
        return duckdb_manager.get_unique_values("vendor")

    @staticmethod
    def get_categories() -> list[str]:
        return duckdb_manager.get_unique_values("category")

    @staticmethod
    def get_statuses() -> list[str]:
        return duckdb_manager.get_unique_values("status")

    @staticmethod
    def get_date_range() -> tuple[str | None, str | None]:
        try:
            df = duckdb_manager.execute_query(
                "SELECT MIN(transaction_date) as min_date, MAX(transaction_date) as max_date FROM active_dataset"
            )
            if not df.empty and df.iloc[0]["min_date"] is not None:
                return str(df.iloc[0]["min_date"]), str(df.iloc[0]["max_date"])
        except Exception:
            pass
        return None, None

    @staticmethod
    def get_sample_records(limit: int = 10) -> pd.DataFrame:
        try:
            return duckdb_manager.execute_query(f"SELECT * FROM active_dataset LIMIT {limit}")
        except Exception:
            return pd.DataFrame()

finance_repository = FinanceRepository()
