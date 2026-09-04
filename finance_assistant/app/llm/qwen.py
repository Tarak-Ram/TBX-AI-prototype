from typing import Any
from app.core.config import settings
from app.finance.schemas import ExecutionResult, FinancialIntent
from app.llm.base import LLMProvider
from app.llm.sarvam import SarvamProvider

class QwenProvider(LLMProvider):
    """Alternative LLM Provider for Qwen/OpenAI compatible models."""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or settings.qwen_api_key
        self.model = model or settings.qwen_model
        self._fallback = SarvamProvider()

    def extract_intent(
        self,
        question: str,
        context: dict[str, Any] | None = None,
        available_schema: dict[str, str] | None = None,
        ontology_metadata: dict[str, Any] | None = None
    ) -> FinancialIntent:
        # Fallback to robust deterministic/sarvam parsing
        return self._fallback.extract_intent(question, context, available_schema, ontology_metadata)

    def generate_explanation(
        self,
        question: str,
        execution_result: ExecutionResult,
        intent: FinancialIntent
    ) -> str:
        return self._fallback.generate_explanation(question, execution_result, intent)
