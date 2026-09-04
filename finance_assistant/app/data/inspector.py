import re
from typing import Any
import pandas as pd
from pydantic import BaseModel, Field

class ColumnProfile(BaseModel):
    name: str
    inferred_type: str
    nullable: bool
    missing_count: int
    missing_percentage: float
    unique_count: int
    sample_values: list[Any] = Field(default_factory=list)
    is_monetary: bool = False
    is_date: bool = False
    is_identifier: bool = False
    is_vendor_candidate: bool = False
    is_category_candidate: bool = False
    is_status_candidate: bool = False

class DatasetProfile(BaseModel):
    total_rows: int
    total_columns: int
    duplicate_rows: int
    columns: dict[str, ColumnProfile]
    suggested_date_column: str | None = None
    suggested_amount_column: str | None = None
    suggested_vendor_column: str | None = None
    suggested_status_column: str | None = None
    suggested_category_column: str | None = None

class DatasetInspector:
    """Inspects, profiles, and detects types and financial semantics of uploaded datasets."""

    MONETARY_SYMBOLS = {"₹", "$", "€", "£", "¥", "rs", "inr", "usd", "eur", "gbp"}
    VENDOR_KEYWORDS = {"vendor", "supplier", "payee", "merchant", "party", "beneficiary", "recipient", "biller", "entity", "name"}
    AMOUNT_KEYWORDS = {"amount", "paid", "payment", "total", "value", "cost", "price", "credit", "debit", "payout", "spend", "net"}
    DATE_KEYWORDS = {"date", "time", "txn_date", "txndate", "timestamp", "period", "day", "month"}
    STATUS_KEYWORDS = {"status", "state", "reconciled", "recon_status", "payment_status", "reconciliation"}
    CATEGORY_KEYWORDS = {"category", "department", "type", "expense_type", "tag", "class", "sector"}
    ID_KEYWORDS = {"id", "ref", "reference", "txn_id", "transaction_id", "invoice", "code", "num", "number"}

    @classmethod
    def clean_monetary_series(cls, series: pd.Series) -> pd.Series:
        """Attempts to parse string with currency symbols/commas to float."""
        if pd.api.types.is_numeric_dtype(series):
            return series
        
        def clean_val(val):
            if pd.isna(val):
                return None
            s = str(val).strip()
            if not s:
                return None
            # Handle parentheses or minus for negative numbers e.g. (1,200.00) or -₹50.00
            is_negative = (s.startswith("(") and s.endswith(")")) or "-" in s
            # Remove all characters except digits and decimal point
            s_clean = re.sub(r"[^\d.]", "", s)
            if not s_clean:
                return None
            try:
                num = float(s_clean)
                return -num if is_negative else num
            except ValueError:
                return None

        return series.map(clean_val)

    @classmethod
    def is_monetary_column(cls, series: pd.Series, col_name: str) -> bool:
        """Determines if a column represents monetary data."""
        # 1. Column name hint
        norm_name = col_name.lower().replace("_", "").replace(" ", "")
        has_amount_keyword = any(k in norm_name for k in cls.AMOUNT_KEYWORDS)
        
        # Numeric dtype check
        if pd.api.types.is_numeric_dtype(series):
            # If named like amount, high certainty
            if has_amount_keyword:
                return True
            # Float with non-integer variations or non-ID scale
            if series.nunique() > 1 and not norm_name.endswith("id"):
                return True
            return False

        # String dtype with currency symbols or parseable numbers
        non_null = series.dropna()
        if len(non_null) == 0:
            return False
        
        sample = non_null.head(50)
        has_currency_symbols = any(
            any(sym in str(x).lower() for sym in cls.MONETARY_SYMBOLS)
            for x in sample
        )
        if has_currency_symbols:
            return True

        # Check if >= 80% of samples can be parsed as numbers
        cleaned = cls.clean_monetary_series(sample)
        valid_numeric_ratio = cleaned.notna().sum() / len(sample)
        if valid_numeric_ratio >= 0.8 and has_amount_keyword:
            return True

        return False

    @classmethod
    def is_date_column(cls, series: pd.Series, col_name: str) -> bool:
        """Determines if a column represents dates/timestamps."""
        if pd.api.types.is_datetime64_any_dtype(series):
            return True

        norm_name = col_name.lower().replace("_", "").replace(" ", "")
        has_date_keyword = any(k in norm_name for k in cls.DATE_KEYWORDS)

        non_null = series.dropna()
        if len(non_null) == 0:
            return False
        
        sample = non_null.head(30)
        # Try parsing dates with pandas
        parsed_count = 0
        for val in sample:
            s_val = str(val).strip()
            # Avoid pure small integers being parsed as timestamps
            if s_val.isdigit() and len(s_val) < 6:
                continue
            try:
                pd.to_datetime(s_val, errors="raise")
                parsed_count += 1
            except (ValueError, TypeError, OverflowError):
                pass

        if parsed_count / len(sample) >= 0.7:
            return True
        return False

    @classmethod
    def inspect(cls, df: pd.DataFrame) -> DatasetProfile:
        total_rows = len(df)
        total_columns = len(df.columns)
        duplicate_rows = int(df.duplicated().sum())

        columns_profile: dict[str, ColumnProfile] = {}
        
        date_candidates = []
        amount_candidates = []
        vendor_candidates = []
        status_candidates = []
        category_candidates = []

        for col in df.columns:
            series = df[col]
            missing_count = int(series.isna().sum())
            missing_pct = round((missing_count / total_rows) * 100, 2) if total_rows > 0 else 0.0
            unique_count = int(series.nunique())
            
            non_null = series.dropna()
            sample_vals = [v if not isinstance(v, (pd.Timestamp, pd.Timedelta)) else str(v) for v in non_null.head(5).tolist()]

            is_monetary = cls.is_monetary_column(series, col)
            is_date = cls.is_date_column(series, col)
            
            norm_col = col.lower().replace("_", " ").strip()
            norm_tokens = set(norm_col.split())

            is_id = any(k in norm_tokens for k in cls.ID_KEYWORDS) or norm_col.endswith(" id")
            is_vendor = any(k in norm_tokens for k in cls.VENDOR_KEYWORDS) and not is_monetary and not is_date
            is_status = any(k in norm_tokens for k in cls.STATUS_KEYWORDS) and unique_count < 20
            is_category = any(k in norm_tokens for k in cls.CATEGORY_KEYWORDS) and unique_count < 100

            # Additional heuristics if unique values look like status or vendor
            if not is_vendor and not is_monetary and not is_date and not is_id and unique_count > 1:
                if any(k in norm_col for k in ["vendor", "supplier", "payee", "party"]):
                    is_vendor = True

            inferred_type = "string"
            if is_monetary:
                inferred_type = "monetary"
                amount_candidates.append(col)
            elif is_date:
                inferred_type = "date"
                date_candidates.append(col)
            elif pd.api.types.is_numeric_dtype(series):
                inferred_type = "numeric"
            elif is_status or (unique_count < 15 and total_rows > 30):
                inferred_type = "categorical"
            
            if is_vendor:
                vendor_candidates.append(col)
            if is_status:
                status_candidates.append(col)
            if is_category:
                category_candidates.append(col)

            columns_profile[col] = ColumnProfile(
                name=col,
                inferred_type=inferred_type,
                nullable=missing_count > 0,
                missing_count=missing_count,
                missing_percentage=missing_pct,
                unique_count=unique_count,
                sample_values=sample_vals,
                is_monetary=is_monetary,
                is_date=is_date,
                is_identifier=is_id,
                is_vendor_candidate=is_vendor,
                is_category_candidate=is_category,
                is_status_candidate=is_status,
            )

        # Select top candidates
        suggested_date = date_candidates[0] if date_candidates else None
        suggested_amount = amount_candidates[0] if amount_candidates else None
        suggested_vendor = vendor_candidates[0] if vendor_candidates else None
        suggested_status = status_candidates[0] if status_candidates else None
        suggested_category = category_candidates[0] if category_candidates else None

        return DatasetProfile(
            total_rows=total_rows,
            total_columns=total_columns,
            duplicate_rows=duplicate_rows,
            columns=columns_profile,
            suggested_date_column=suggested_date,
            suggested_amount_column=suggested_amount,
            suggested_vendor_column=suggested_vendor,
            suggested_status_column=suggested_status,
            suggested_category_column=suggested_category,
        )
