from datetime import datetime
from app.conversation.state import ConversationState, Message
from app.finance.schemas import FinancialIntent, ResponsePayload

class ConversationResolver:
    """Manages conversational session storage and updates state across conversation turns."""

    _sessions: dict[str, ConversationState] = {}

    @classmethod
    def get_or_create(cls, conversation_id: str) -> ConversationState:
        if conversation_id not in cls._sessions:
            cls._sessions[conversation_id] = ConversationState(conversation_id=conversation_id)
        return cls._sessions[conversation_id]

    @classmethod
    def update_state(
        cls,
        state: ConversationState,
        user_question: str,
        intent: FinancialIntent,
        payload: ResponsePayload
    ) -> ConversationState:
        # Add user message
        state.messages.append(Message(role="user", content=user_question))

        # Update entity carryover
        if intent.vendor:
            state.active_vendor = intent.vendor
        elif intent.operation == "ranking":
            # If ranking was requested, do not pin a single vendor
            state.active_vendor = None

        if intent.date_label:
            state.active_period = intent.date_label
        if intent.domain:
            state.active_domain = intent.domain
        if intent.category:
            state.active_category = intent.category

        state.last_intent = intent
        state.last_query_id = payload.query_id
        state.updated_at = datetime.utcnow().isoformat()

        # Add assistant message
        state.messages.append(Message(role="assistant", content=payload.answer, payload=payload))
        return state
