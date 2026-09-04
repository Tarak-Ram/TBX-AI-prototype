import pandas as pd
from app.data.dataset_manager import DatasetManager

def test_dataset_versioning_and_deduplication(tmp_path):
    mgr = DatasetManager(metadata_path=tmp_path / "test_reg.json")
    df1 = pd.DataFrame({
        "Vendor": ["Acme", "XYZ"],
        "Amount": [100.0, 200.0],
    })
    # 1. Create v1
    rep1 = mgr.create_dataset(df1, "test_corp", "Test Corp", "test1.csv")
    assert rep1.version == 1
    assert rep1.records_added == 2

    # 2. Add with 1 duplicate and 1 new
    df2 = pd.DataFrame({
        "Vendor": ["Acme", "NewVendor"],
        "Amount": [100.0, 300.0],
    })
    rep2 = mgr.add_to_dataset(df2, "test_corp", "test2.csv")
    assert rep2.version == 2
    assert rep2.duplicates_skipped == 1
    assert rep2.records_added == 1

    # 3. Replace dataset
    df3 = pd.DataFrame({
        "Vendor": ["BrandNew"],
        "Amount": [999.0],
    })
    rep3 = mgr.replace_dataset(df3, "test_corp", "test3.csv")
    assert rep3.version == 3
    assert rep3.records_added == 1
