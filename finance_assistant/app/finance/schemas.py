from datetime import date
from typing import Any
from pydantic import BaseModel, Field

class FinancialIntent(BaseModel):
    domain: str = Field(description="One of: transactions, vendor_payouts, reconciliation")
    operation: str = Field(description="One of: sum, count, list, ranking, group_by, comparison")
    metric: str | None = Field(default="amount", description="Metric to compute, e.g. amount, transaction_count")
    vendor: str | None = Field(default=None, description="Vendor entity if mentioned")
    category: str | None = Field(default=None, description="Expense category if mentioned")
    status: str | None = Field(default=None, description="Status if mentioned e.g. reconciled, unreconciled, pending")
    start_date: date | None = Field(default=None, description="Start date of half-open interval [start, end)")
    end_date: date | None = Field(default=None, description="End date of half-open interval [start, end)")
    date_label: str | None = Field(default=None, description="Human readable period label e.g. August 2026")
    group_by: str | None = Field(default=None, description="Field to group by, e.g. month, vendor, category")
    comparison_period: str | None = Field(default=None, description="Period to compare against e.g. previous month")
    comparison_vendor: str | None = Field(default=None, description="Second vendor to compare against")
    limit: int | None = Field(default=10, description="Limit for lists or rankings")
    confidence: float = Field(default=1.0)
    raw_question: str | None = None

class QueryPlan(BaseModel):
    template_name: str
    sql: str
    parameters: list[Any] = Field(default_factory=list)
    filters_applied: dict[str, Any] = Field(default_factory=dict)
    calculation_desc: str
    aggregation_operation: str
    target_metric: str

class ExecutionResult(BaseModel):
    query_id: str
    dataset_id: str
    dataset_version: int
    filters: dict[str, Any] = Field(default_factory=dict)
    row_count: int
    calculation: dict[str, str] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    breakdown: list[dict[str, Any]] = Field(default_factory=list)
    supporting_records: list[dict[str, Any]] = Field(default_factory=list)
    execution_time_ms: float = 0.0

class Evidence(BaseModel):
    query_id: str
    dataset_version: int
    period: str | None = None
    filters: dict[str, Any] = Field(default_factory=dict)
    row_count: int
    calculation: dict[str, str] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    supporting_records: list[dict[str, Any]] = Field(default_factory=list)
    total_records_in_dataset: int = 0

class ResponsePayload(BaseModel):
    answer: str
    calculation: str
    period: str | None = None
    records: int
    confidence: str  # HIGH, MEDIUM, LOW
    query_id: str
    evidence: Evidence | None = None
    breakdown: list[dict[str, Any]] = Field(default_factory=list)
    needs_clarification: bool = False
    clarification_options: list[str] = Field(default_factory=list)
    is_unsupported: bool = False
    is_not_found: bool = False
