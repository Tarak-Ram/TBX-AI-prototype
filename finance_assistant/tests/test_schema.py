import pandas as pd
from app.data.inspector import DatasetInspector
from app.data.schema_mapper import SchemaCompatibilityChecker, SchemaMapper

def test_schema_compatibility_success():
    df = pd.DataFrame({
        "Supplier": ["Acme", "Beta"],
        "Payment": ["1000", "2000"],
        "TxnDate": ["2026-08-01", "2026-08-02"],
        "PaymentStatus": ["Paid", "Pending"]
    })
    profile = DatasetInspector.inspect(df)
    compat = SchemaCompatibilityChecker.check_compatibility(profile)
    assert compat.compatible is True
    assert compat.mapped_fields["amount"] == "Payment"
    assert compat.mapped_fields["vendor"] == "Supplier"
    assert "vendor_payouts" in compat.supported_domains

def test_schema_compatibility_missing_amount():
    df = pd.DataFrame({
        "Supplier": ["Acme", "Beta"],
        "City": ["Bangalore", "Mumbai"],
    })
    profile = DatasetInspector.inspect(df)
    compat = SchemaCompatibilityChecker.check_compatibility(profile)
    assert compat.compatible is False
    assert "amount" in compat.missing_required_fields

def test_schema_mapper_apply():
    df = pd.DataFrame({
        "Supplier": ["Acme Corp"],
        "Payment": ["\xe2\x82\xb910,000.50"],
        "TxnDate": ["2026-08-15"]
    })
    mapped = SchemaMapper.apply_mapping(df, {"vendor": "Supplier", "amount": "Payment", "transaction_date": "TxnDate"})
    assert "vendor" in mapped.columns
    assert "amount" in mapped.columns
    assert mapped["amount"].iloc[0] == 10000.50
    assert str(mapped["transaction_date"].iloc[0]) == "2026-08-15"
