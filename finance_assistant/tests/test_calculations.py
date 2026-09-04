import pandas as pd
from app.data.duckdb import DuckDBManager
from app.data.dataset_manager import DatasetManager
from app.finance.calculator import FinancialCalculator
from app.finance.query_templates import QueryTemplates
from app.finance.schemas import QueryPlan

def test_duckdb_deterministic_sum():
    db = DuckDBManager(":memory:")
    df = pd.DataFrame({
        "vendor": ["Acme", "Acme", "XYZ"],
        "amount": [1000.0, 2500.0, 5000.0],
        "transaction_date": ["2026-08-10", "2026-08-15", "2026-08-20"],
    })
    db.register_dataframe("active_dataset", df)
    res = db.execute_query("SELECT SUM(amount) as s FROM active_dataset WHERE vendor = ?", ["Acme"])
    assert res.iloc[0]["s"] == 3500.0

def test_duckdb_deterministic_count():
    db = DuckDBManager(":memory:")
    df = pd.DataFrame({"amount": [10.0, 20.0, 30.0]})
    db.register_dataframe("active_dataset", df)
    count = db.get_row_count("active_dataset")
    assert count == 3
