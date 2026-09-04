from typing import Any
from app.core.exceptions import (
    AmbiguousEntityError,
    EntityNotFoundError,
    IncompatibleSchemaError,
    UnsupportedQuestionError,
)
from app.core.logging import logger
from app.data.dataset_manager import dataset_manager
from app.finance.date_resolver import DateResolver
from app.finance.entity_resolver import EntityResolver
from app.finance.ontology import FinancialOntology
from app.finance.query_templates import ParameterizedQuery, QueryTemplates
from app.finance.schemas import FinancialIntent, QueryPlan

class QueryPlanner:
    """Compiles validated FinancialIntent into approved parameterized queries with entity & date resolution."""

    @classmethod
    def plan(cls, intent: FinancialIntent) -> tuple[QueryPlan, dict[str, Any]]:
        ds_meta, active_version = dataset_manager.get_active_dataset()
        if not active_version:
            raise IncompatibleSchemaError("No active dataset is available. Please upload a dataset first.")

        available_fields = list(active_version.mapped_fields.keys())

        # 1. Ontology domain capability validation
        is_supported, reason = FinancialOntology.validate_domain_capabilities(intent.domain, available_fields)
        if not is_supported:
            raise UnsupportedQuestionError(reason or f"The domain '{intent.domain}' is not supported by the dataset.")

        resolved_filters: dict[str, Any] = {}

        # 2. Entity Resolution for vendor if present
        resolved_vendor = None
        if intent.vendor:
            resolution = EntityResolver.resolve_vendor(intent.vendor)
            if resolution.status == "not_found":
                raise EntityNotFoundError(f"Vendor '{intent.vendor}' was not found in the dataset.")
            elif resolution.status == "multiple_matches":
                raise AmbiguousEntityError(
                    f"Multiple vendors match '{intent.vendor}': {', '.join(resolution.candidates)}",
                    details={"candidates": resolution.candidates}
                )
            resolved_vendor = resolution.resolved_entity
            resolved_filters["vendor"] = resolved_vendor

        # 3. Date Resolution if dates or labels provided
        start_str = None
        end_str = None
        if intent.start_date and intent.end_date:
            start_str = str(intent.start_date)
            end_str = str(intent.end_date)
            resolved_filters["start_date"] = start_str
            resolved_filters["end_date"] = end_str
            resolved_filters["period"] = intent.date_label or f"{start_str} to {end_str}"
        elif intent.date_label:
            interval = DateResolver.resolve(intent.date_label)
            if interval:
                start_str = str(interval.start_date)
                end_str = str(interval.end_date)
                resolved_filters["start_date"] = start_str
                resolved_filters["end_date"] = end_str
                resolved_filters["period"] = interval.label

        # 4. Route to approved query template
        param_query: ParameterizedQuery

        if intent.operation == "comparison":
            # Comparison will be handled via subqueries or dual plan
            if resolved_vendor:
                param_query = QueryTemplates.vendor_payout_sum(resolved_vendor, start_str, end_str)
            else:
                param_query = QueryTemplates.total_spend(start_str, end_str)

        elif intent.operation == "ranking":
            limit = intent.limit or 5
            param_query = QueryTemplates.vendor_ranking(limit=limit, start_date=start_str, end_date=end_str)
            resolved_filters["limit"] = limit

        elif intent.operation == "count":
            param_query = QueryTemplates.transaction_count(vendor=resolved_vendor, start_date=start_str, end_date=end_str)

        elif intent.operation == "list":
            limit = intent.limit or 25
            param_query = QueryTemplates.transaction_list(
                vendor=resolved_vendor,
                category=intent.category,
                status=intent.status,
                start_date=start_str,
                end_date=end_str,
                limit=limit
            )
            resolved_filters["limit"] = limit

        elif intent.operation == "group_by":
            if intent.group_by in ["month", "monthly", "date"]:
                param_query = QueryTemplates.monthly_payout(vendor=resolved_vendor)
            elif intent.group_by in ["vendor"]:
                param_query = QueryTemplates.vendor_ranking(limit=intent.limit or 10, start_date=start_str, end_date=end_str)
            elif intent.group_by in ["category"]:
                param_query = QueryTemplates.category_spend(category=None, start_date=start_str, end_date=end_str, limit=intent.limit or 10)
            else:
                param_query = QueryTemplates.vendor_ranking(limit=5, start_date=start_str, end_date=end_str)

        elif intent.domain == "reconciliation":
            is_unrecon = (intent.status and "unrecon" in intent.status.lower()) or (intent.status is None)
            param_query = QueryTemplates.reconciliation_query(
                is_unreconciled_only=is_unrecon,
                start_date=start_str,
                end_date=end_str
            )

        elif intent.category:
            param_query = QueryTemplates.category_spend(
                category=intent.category,
                start_date=start_str,
                end_date=end_str
            )
            resolved_filters["category"] = intent.category

        elif resolved_vendor:
            param_query = QueryTemplates.vendor_payout_sum(
                vendor=resolved_vendor,
                start_date=start_str,
                end_date=end_str
            )

        else:
            # Default total spend
            param_query = QueryTemplates.total_spend(start_date=start_str, end_date=end_str)

        plan = QueryPlan(
            template_name=param_query.template_name,
            sql=param_query.sql.strip(),
            parameters=param_query.params,
            filters_applied=resolved_filters,
            calculation_desc=param_query.calculation_desc,
            aggregation_operation=intent.operation.upper(),
            target_metric=param_query.target_metric,
        )

        return plan, resolved_filters
