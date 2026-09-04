from fastapi import APIRouter, HTTPException
from app.data.dataset_manager import dataset_manager
from app.finance.calculator import FinancialCalculator
from app.finance.query_planner import QueryPlanner
from app.finance.schemas import ExecutionResult, FinancialIntent
from app.finance.validator import ResultValidator

router = APIRouter(prefix="/query", tags=["Query Engine"])

@router.post("", response_model=ExecutionResult)
def execute_query_intent(intent: FinancialIntent):
    """Directly executes structured FinancialIntent deterministically without natural language parsing."""
    ds_meta, active_version = dataset_manager.get_active_dataset()
    if not active_version:
        raise HTTPException(status_code=400, detail="No active dataset available.")

    plan, _ = QueryPlanner.plan(intent)
    result = FinancialCalculator.execute(plan)
    ResultValidator.validate_execution(result, active_version.dataset_version)
    return result
