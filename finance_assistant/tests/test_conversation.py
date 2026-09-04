from app.conversation.context import ConversationContext
from app.conversation.resolver import ConversationResolver
from app.finance.schemas import FinancialIntent, ResponsePayload

def test_multi_turn_entity_carryover():
    state = ConversationResolver.get_or_create("test_conv_1")
    intent1 = FinancialIntent(domain="vendor_payouts", operation="sum", vendor="Acme Corp", date_label="August 2026")
    payload1 = ResponsePayload(
        answer="Acme Corp received \xe2\x82\xb912.43M in August 2026.",
        calculation="SUM(amount)",
        records=842,
        confidence="HIGH",
        query_id="Q-TEST-1",
    )
    ConversationResolver.update_state(state, "How much did Acme receive last month?", intent1, payload1)
    assert state.active_vendor == "Acme Corp"
    assert state.active_period == "August 2026"

    # Turn 2: "What about July?"
    ctx = ConversationContext.get_context_dict(state)
    assert ctx["vendor"] == "Acme Corp"
