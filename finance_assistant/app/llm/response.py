from app.core.exceptions import GuardrailViolationError
from app.core.logging import logger
from app.finance.evidence import EvidenceManager
from app.finance.schemas import ExecutionResult, FinancialIntent, ResponsePayload
from app.finance.validator import FinalResponseGuardrail
from app.llm.base import LLMProvider
from app.llm.sarvam import SarvamProvider

class ResponseGenerator:
    """Generates verified, guarded financial responses adhering strictly to Section 28 & 29."""

    def __init__(self, provider: LLMProvider | None = None):
        self.provider = provider or SarvamProvider()

    def generate_response(
        self,
        question: str,
        execution: ExecutionResult,
        intent: FinancialIntent
    ) -> ResponsePayload:
        evidence = EvidenceManager.create_evidence(execution)

        # 1. Deterministic response baseline
        det_answer = self._format_deterministic_answer(execution, intent)
        
        # 2. Attempt conversational explanation if provider enabled
        final_answer = det_answer
        try:
            explanation = self.provider.generate_explanation(question, execution, intent)
            # Run final response guardrail
            FinalResponseGuardrail.verify_response(explanation, execution)
            final_answer = explanation
        except GuardrailViolationError as gve:
            logger.warning(f"Guardrail triggered! Reverting to deterministic response: {str(gve)}")
            final_answer = det_answer
        except Exception as e:
            logger.warning(f"Explanation failed: {str(e)}. Using deterministic answer.")
            final_answer = det_answer

        calc_str = execution.calculation.get("formula", "SUM(amount)")
        period_str = execution.filters.get("period")
        if not period_str and execution.filters.get("start_date") and execution.filters.get("end_date"):
            period_str = f"{execution.filters['start_date']} – {execution.filters['end_date']}"

        # Confidence calculation
        confidence = "HIGH"
        if intent.confidence < 0.8:
            confidence = "MEDIUM"

        return ResponsePayload(
            answer=final_answer,
            calculation=calc_str,
            period=period_str,
            records=execution.row_count,
            confidence=confidence,
            query_id=execution.query_id,
            evidence=evidence,
            breakdown=execution.breakdown,
        )

    def _format_deterministic_answer(self, execution: ExecutionResult, intent: FinancialIntent) -> str:
        amt = execution.result.get("amount") or execution.result.get("top_amount") or 0.0
        period = execution.filters.get("period", "")
        vendor = execution.filters.get("vendor", "")

        # Format number with Indian numbering/standard formatting
        formatted = f"₹{amt:,.2f}"

        if intent.operation == "ranking" and execution.result.get("top_entity"):
            top = execution.result["top_entity"]
            return f"Vendor {top} received the most with {formatted} across {execution.row_count} payouts."
        elif intent.operation == "list":
            p_str = f" in {period}" if period else ""
            v_str = f" for {vendor}" if vendor else ""
            return f"Found {execution.row_count} transaction(s){v_str}{p_str} totaling {formatted}."
        elif intent.operation == "count":
            return f"{execution.row_count:,} transactions were recorded."
        elif vendor:
            p_str = f" in {period}" if period else ""
            return f"{vendor} received {formatted}{p_str} across {execution.row_count} payouts."
        elif intent.domain == "reconciliation":
            return f"Unreconciled amount is {formatted} across {execution.row_count} transactions."
        else:
            p_str = f" in {period}" if period else ""
            return f"Total spend totaled {formatted}{p_str} across {execution.row_count} records."
