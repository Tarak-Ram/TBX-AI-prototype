from abc import ABC, abstractmethod
from typing import Any
from app.finance.schemas import ExecutionResult, FinancialIntent

class LLMProvider(ABC):
    """Abstract base class for all language model providers."""

    @abstractmethod
    def extract_intent(
        self,
        question: str,
        context: dict[str, Any] | None = None,
        available_schema: dict[str, str] | None = None,
        ontology_metadata: dict[str, Any] | None = None
    ) -> FinancialIntent:
        """Translates natural language input and conversational context into structured FinancialIntent."""
        pass

    @abstractmethod
    def generate_explanation(
        self,
        question: str,
        execution_result: ExecutionResult,
        intent: FinancialIntent
    ) -> str:
        """Explains deterministic financial computation results to the user."""
        pass
