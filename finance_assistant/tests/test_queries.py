from app.finance.query_templates import QueryTemplates

def test_total_spend_query_generation():
    q = QueryTemplates.total_spend("2026-08-01", "2026-09-01")
    assert "SUM(amount)" in q.sql
    assert q.params == ["2026-08-01", "2026-09-01"]

def test_vendor_payout_sum_parameterization():
    q = QueryTemplates.vendor_payout_sum("Acme Corp", "2026-08-01", "2026-09-01")
    assert "LOWER(vendor) = LOWER(?)" in q.sql
    assert q.params[0] == "Acme Corp"

def test_vendor_ranking_parameterization():
    q = QueryTemplates.vendor_ranking(limit=5)
    assert "ORDER BY total_amount DESC" in q.sql
    assert q.params == [5]
