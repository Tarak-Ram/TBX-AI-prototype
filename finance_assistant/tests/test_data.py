import pytest
import pandas as pd
from app.data.loader import DataLoader
from app.data.inspector import DatasetInspector

def test_load_from_bytes_csv():
    csv_bytes = b"Vendor,Amount,Date\nAcme,1000.50,2026-08-01\nBeta,2500.00,2026-08-02"
    df = DataLoader.load_from_bytes(csv_bytes, "test.csv")
    assert len(df) == 2
    assert list(df.columns) == ["Vendor", "Amount", "Date"]

def test_monetary_series_cleaning():
    series = pd.Series(["\xe2\x82\xb912,000", "$8,500.50", "(1,200)", "  500 "])
    cleaned = DatasetInspector.clean_monetary_series(series)
    assert cleaned.iloc[0] == 12000.0
    assert cleaned.iloc[1] == 8500.50
    assert cleaned.iloc[2] == -1200.0
    assert cleaned.iloc[3] == 500.0

def test_dataset_inspector():
    df = pd.DataFrame({
        "Supplier Name": ["Acme Corp", "Beta LLC", "Acme Corp"],
        "Payment Total": ["\xe2\x82\xb912,000", "\xe2\x82\xb95,000", "\xe2\x82\xb93,000"],
        "Txn Date": ["2026-08-01", "2026-08-02", "2026-08-03"],
        "Recon Status": ["Reconciled", "Unreconciled", "Reconciled"],
    })
    profile = DatasetInspector.inspect(df)
    assert profile.total_rows == 3
    assert profile.suggested_vendor_column == "Supplier Name"
    assert profile.suggested_amount_column == "Payment Total"
    assert profile.suggested_date_column == "Txn Date"
    assert profile.suggested_status_column == "Recon Status"
