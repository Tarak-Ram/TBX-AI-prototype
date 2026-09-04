from app.finance.schemas import FinancialIntent
from app.llm.sarvam import SarvamProvider

def test_intent_parsing_spend_last_month():
    provider = SarvamProvider()
    intent = provider.extract_intent("How much did we spend last month?")
    assert intent.domain in ["transactions", "vendor_payouts"]
    assert intent.operation == "sum"
    assert intent.date_label == "last month"

def test_intent_parsing_vendor_ranking():
    provider = SarvamProvider()
    intent = provider.extract_intent("Which vendor received the most?")
    assert intent.domain == "vendor_payouts"
    assert intent.operation == "ranking"

def test_intent_parsing_reconciliation():
    provider = SarvamProvider()
    intent = provider.extract_intent("What is the unreconciled amount?")
    assert intent.domain == "reconciliation"
    assert intent.status == "unreconciled"

def test_intent_parsing_multi_turn():
    provider = SarvamProvider()
    context = {"vendor": "Acme", "period": "August 2026", "domain": "vendor_payouts"}
    intent = provider.extract_intent("What about July?", context=context)
    assert intent.vendor == "Acme"
    assert intent.date_label == "july"
