from app.finance.entity_resolver import EntityResolver

VENDORS = ["Acme Corp", "XYZ Logistics", "CloudScale Systems", "Acme International"]

def test_exact_vendor_match():
    res = EntityResolver.resolve_vendor("Acme Corp", existing_vendors=VENDORS)
    assert res.status == "exact_match"
    assert res.resolved_entity == "Acme Corp"

def test_normalized_vendor_match():
    res = EntityResolver.resolve_vendor("acme corp inc", existing_vendors=VENDORS)
    assert res.resolved_entity in ["Acme Corp", "Acme International"]

def test_multiple_candidates_ambiguous():
    res = EntityResolver.resolve_vendor("Acme", existing_vendors=VENDORS)
    assert res.status in ["multiple_matches", "exact_match", "approximate_match"]
    assert len(res.candidates) >= 1

def test_unknown_vendor_not_found():
    res = EntityResolver.resolve_vendor("Unknown Phantom Vendor", existing_vendors=VENDORS)
    assert res.status == "not_found"
    assert res.resolved_entity is None
    assert "not found" in res.message.lower()
