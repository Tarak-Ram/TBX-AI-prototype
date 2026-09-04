from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.conversation.context import ConversationContext
from app.conversation.resolver import ConversationResolver
from app.core.exceptions import (
    AmbiguousEntityError,
    EntityNotFoundError,
    IncompatibleSchemaError,
    UnsupportedQuestionError,
)
from app.core.logging import logger
from app.data.dataset_manager import dataset_manager
from app.finance.calculator import FinancialCalculator
from app.finance.query_planner import QueryPlanner
from app.finance.schemas import ResponsePayload
from app.finance.validator import ResultValidator
from app.llm.response import ResponseGenerator
from app.llm.sarvam import SarvamProvider

router = APIRouter(prefix="/chat", tags=["Chat"])

class ChatRequest(BaseModel):
    question: str
    conversation_id: str = "default"

@router.post("", response_model=ResponsePayload)
def chat_endpoint(req: ChatRequest):
    """Executes natural-language financial query compiler pipeline."""
    # 1. Check dataset availability
    ds_meta, active_version = dataset_manager.get_active_dataset()
    if not active_version:
        return ResponsePayload(
            answer="No dataset is currently uploaded. Please upload a CSV, TSV, or Excel financial dataset in the sidebar to get started.",
            calculation="None",
            records=0,
            confidence="LOW",
            query_id="NONE",
            is_unsupported=True,
        )

    # 2. Retrieve conversation state
    state = ConversationResolver.get_or_create(req.conversation_id)
    context_dict = ConversationContext.get_context_dict(state)

    # 3. LLM/Compiler Intent Extraction
    provider = SarvamProvider()
    try:
        intent = provider.extract_intent(
            question=req.question,
            context=context_dict,
            available_schema=active_version.mapped_fields,
        )
    except Exception as e:
        logger.error(f"Intent extraction error: {str(e)}")
        return ResponsePayload(
            answer="I was unable to interpret that question in the context of the current financial ontology.",
            calculation="None",
            records=0,
            confidence="LOW",
            query_id="NONE",
            is_unsupported=True,
        )

    # 4. Handle Unsupported domain / question
    try:
        query_plan, resolved_filters = QueryPlanner.plan(intent)
    except EntityNotFoundError as enfe:
        return ResponsePayload(
            answer=str(enfe),
            calculation="Entity validation: Not Found",
            records=0,
            confidence="HIGH",
            query_id="NOT_FOUND",
            is_not_found=True,
        )
    except AmbiguousEntityError as aee:
        candidates = aee.details.get("candidates", [])
        return ResponsePayload(
            answer=str(aee),
            calculation="Entity validation: Ambiguous",
            records=0,
            confidence="MEDIUM",
            query_id="AMBIGUOUS",
            needs_clarification=True,
            clarification_options=candidates,
        )
    except UnsupportedQuestionError as uqe:
        return ResponsePayload(
            answer=f"I cannot answer that question because {str(uqe)}",
            calculation="Ontology Validation: Unsupported",
            records=0,
            confidence="HIGH",
            query_id="UNSUPPORTED",
            is_unsupported=True,
        )
    except IncompatibleSchemaError as ise:
        return ResponsePayload(
            answer=f"The uploaded dataset does not contain enough information: {str(ise)}",
            calculation="Schema Validation: Incompatible",
            records=0,
            confidence="LOW",
            query_id="INCOMPATIBLE",
            is_unsupported=True,
        )

    # 5. Deterministic Execution via DuckDB
    try:
        execution_result = FinancialCalculator.execute(query_plan)
        # 6. Result Validation
        ResultValidator.validate_execution(execution_result, active_version.dataset_version)
    except Exception as e:
        logger.error(f"Execution/validation error: {str(e)}")
        return ResponsePayload(
            answer="A computation error occurred while evaluating the financial query.",
            calculation=query_plan.calculation_desc,
            records=0,
            confidence="LOW",
            query_id="ERROR",
            is_unsupported=True,
        )

    # 7. Response Generation with Hallucination Guardrails & Evidence
    response_gen = ResponseGenerator(provider=provider)
    payload = response_gen.generate_response(req.question, execution_result, intent)

    # 8. Update conversation state
    ConversationResolver.update_state(state, req.question, intent, payload)

    return payload
