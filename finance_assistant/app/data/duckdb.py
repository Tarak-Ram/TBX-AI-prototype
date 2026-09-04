from typing import Any
import duckdb
import pandas as pd
from app.core.exceptions import QueryExecutionError
from app.core.logging import logger

class DuckDBManager:
    """Manages the DuckDB analytical computation engine with parameterized queries."""

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)
        logger.info(f"Initialized DuckDB connection (db_path={db_path})")

    def register_dataframe(self, table_name: str, df: pd.DataFrame):
        """Registers a pandas dataframe as a DuckDB table/view."""
        try:
            self.conn.register(f"{table_name}_view", df)
            # Create a real in-engine table for fast indexing/querying
            self.conn.execute(f"CREATE OR REPLACE TABLE {table_name} AS SELECT * FROM {table_name}_view")
            logger.info(f"Registered table '{table_name}' with {len(df)} rows in DuckDB.")
        except Exception as e:
            logger.error(f"Error registering table {table_name}: {str(e)}")
            raise QueryExecutionError(f"Failed to register dataset in DuckDB: {str(e)}")

    def set_active_table(self, table_name: str):
        """Creates or updates the 'active_dataset' view to point to the active version."""
        try:
            self.conn.execute(f"CREATE OR REPLACE VIEW active_dataset AS SELECT * FROM {table_name}")
            logger.info(f"Set 'active_dataset' view -> '{table_name}'")
        except Exception as e:
            logger.error(f"Failed to set active view to {table_name}: {str(e)}")
            raise QueryExecutionError(f"Failed to switch active dataset: {str(e)}")

    def execute_query(self, query: str, params: list[Any] | None = None) -> pd.DataFrame:
        """Executes parameterized SQL deterministically."""
        try:
            logger.info(f"Executing DuckDB SQL: {query} | Params: {params}")
            if params:
                result = self.conn.execute(query, params).df()
            else:
                result = self.conn.execute(query).df()
            return result
        except Exception as e:
            logger.error(f"DuckDB Execution Error: {str(e)} | Query: {query} | Params: {params}")
            raise QueryExecutionError(f"Database query execution failed: {str(e)}")

    def execute_scalar(self, query: str, params: list[Any] | None = None) -> Any:
        df = self.execute_query(query, params)
        if df.empty or len(df.columns) == 0:
            return None
        return df.iloc[0, 0]

    def table_exists(self, table_name: str) -> bool:
        try:
            res = self.conn.execute(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?",
                [table_name]
            ).fetchone()
            return bool(res and res[0] > 0)
        except Exception:
            return False

    def get_row_count(self, table_name: str = "active_dataset") -> int:
        try:
            count = self.execute_scalar(f"SELECT COUNT(*) FROM {table_name}")
            return int(count) if count is not None else 0
        except Exception:
            return 0

    def get_unique_values(self, column: str, table_name: str = "active_dataset") -> list[str]:
        try:
            df = self.execute_query(f"SELECT DISTINCT {column} FROM {table_name} WHERE {column} IS NOT NULL ORDER BY {column}")
            return df[column].dropna().astype(str).tolist()
        except Exception:
            return []

    def drop_table(self, table_name: str):
        try:
            self.conn.execute(f"DROP TABLE IF EXISTS {table_name}")
        except Exception as e:
            logger.warning(f"Error dropping table {table_name}: {str(e)}")

duckdb_manager = DuckDBManager()
