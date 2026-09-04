from typing import Any
from app.conversation.state import ConversationState

class ConversationContext:
    """Extracts stateful context dictionary to guide multi-turn intent resolution."""

    @staticmethod
    def get_context_dict(state: ConversationState | None) -> dict[str, Any]:
        if not state:
            return {}
        return {
            "vendor": state.active_vendor,
            "category": state.active_category,
            "period": state.active_period,
            "start_date": state.active_start_date,
            "end_date": state.active_end_date,
            "domain": state.active_domain,
            "last_query_id": state.last_query_id,
        }
