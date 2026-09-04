import calendar
import re
from datetime import date, datetime, timedelta
from typing import Tuple
from pydantic import BaseModel
from app.core.exceptions import DateResolutionError

class ResolvedDateInterval(BaseModel):
    start_date: date
    end_date: date  # Half-open: start_date <= dt < end_date
    label: str
    is_quarter: bool = False
    is_month: bool = False

class DateResolver:
    """Deterministically resolves natural language date expressions into half-open intervals [start, end)."""

    DEFAULT_ANCHOR = date(2026, 9, 4)

    MONTH_NAMES = {
        "january": 1, "jan": 1,
        "february": 2, "feb": 2,
        "march": 3, "mar": 3,
        "april": 4, "apr": 4,
        "may": 5,
        "june": 6, "jun": 6,
        "july": 7, "jul": 7,
        "august": 8, "aug": 8,
        "september": 9, "sep": 9, "sept": 9,
        "october": 10, "oct": 10,
        "november": 11, "nov": 11,
        "december": 12, "dec": 12,
    }

    @classmethod
    def get_month_interval(cls, year: int, month: int) -> Tuple[date, date, str]:
        start = date(year, month, 1)
        if month == 12:
            end = date(year + 1, 1, 1)
        else:
            end = date(year, month + 1, 1)
        label = f"{calendar.month_name[month]} {year}"
        return start, end, label

    @classmethod
    def get_quarter_interval(cls, year: int, quarter: int) -> Tuple[date, date, str]:
        start_month = (quarter - 1) * 3 + 1
        end_month = start_month + 3
        start = date(year, start_month, 1)
        if end_month > 12:
            end = date(year + 1, 1, 1)
        else:
            end = date(year, end_month, 1)
        label = f"Q{quarter} {year}"
        return start, end, label

    @classmethod
    def resolve(cls, text: str | None, anchor: date | None = None) -> ResolvedDateInterval | None:
        if not text or not text.strip():
            return None

        anchor_date = anchor or cls.DEFAULT_ANCHOR
        s = text.lower().strip()

        # Clean noise words
        s = re.sub(r"\b(in|during|for|the|of)\b", "", s).strip()
        s = re.sub(r"\s+", " ", s)

        # 1. "last month" or "previous month"
        if s in ["last month", "previous month", "past month"]:
            year = anchor_date.year
            month = anchor_date.month - 1
            if month == 0:
                month = 12
                year -= 1
            start, end, label = cls.get_month_interval(year, month)
            return ResolvedDateInterval(start_date=start, end_date=end, label=label, is_month=True)

        # 2. "this month" or "current month"
        if s in ["this month", "current month"]:
            start, end, label = cls.get_month_interval(anchor_date.year, anchor_date.month)
            return ResolvedDateInterval(start_date=start, end_date=end, label=label, is_month=True)

        # 3. "last quarter" or "previous quarter"
        if s in ["last quarter", "previous quarter"]:
            curr_quarter = (anchor_date.month - 1) // 3 + 1
            prev_quarter = curr_quarter - 1
            year = anchor_date.year
            if prev_quarter == 0:
                prev_quarter = 4
                year -= 1
            start, end, label = cls.get_quarter_interval(year, prev_quarter)
            return ResolvedDateInterval(start_date=start, end_date=end, label=label, is_quarter=True)

        # 4. "this quarter" or "current quarter"
        if s in ["this quarter", "current quarter"]:
            curr_quarter = (anchor_date.month - 1) // 3 + 1
            start, end, label = cls.get_quarter_interval(anchor_date.year, curr_quarter)
            return ResolvedDateInterval(start_date=start, end_date=end, label=label, is_quarter=True)

        # 5. "year to date" or "ytd"
        if s in ["year to date", "ytd"]:
            start = date(anchor_date.year, 1, 1)
            end = anchor_date + timedelta(days=1)
            return ResolvedDateInterval(
                start_date=start,
                end_date=end,
                label=f"Year to Date ({anchor_date.year})"
            )

        # 6. "last 30 days" or "past 30 days"
        if s in ["last 30 days", "past 30 days"]:
            start = anchor_date - timedelta(days=30)
            end = anchor_date + timedelta(days=1)
            return ResolvedDateInterval(start_date=start, end_date=end, label="Last 30 Days")

        # 7. Quarter with optional year e.g. "q2", "q2 2026", "2nd quarter 2026"
        q_match = re.match(r"^(?:q|quarter\s*)([1-4])(?:\s*(\d{4}))?$", s)
        if q_match:
            quarter = int(q_match.group(1))
            year = int(q_match.group(2)) if q_match.group(2) else anchor_date.year
            start, end, label = cls.get_quarter_interval(year, quarter)
            return ResolvedDateInterval(start_date=start, end_date=end, label=label, is_quarter=True)

        # 8. Month name with optional year e.g. "august", "august 2026", "jul"
        m_match = re.match(r"^([a-z]+)(?:\s*(\d{4}))?$", s)
        if m_match and m_match.group(1) in cls.MONTH_NAMES:
            month = cls.MONTH_NAMES[m_match.group(1)]
            year = int(m_match.group(2)) if m_match.group(2) else anchor_date.year
            start, end, label = cls.get_month_interval(year, month)
            return ResolvedDateInterval(start_date=start, end_date=end, label=label, is_month=True)

        # 9. "between MonthA and MonthB [Year]"
        between_match = re.match(r"^between\s+([a-z]+)\s+and\s+([a-z]+)(?:\s*(\d{4}))?$", s)
        if between_match:
            m1_name, m2_name = between_match.group(1), between_match.group(2)
            if m1_name in cls.MONTH_NAMES and m2_name in cls.MONTH_NAMES:
                m1 = cls.MONTH_NAMES[m1_name]
                m2 = cls.MONTH_NAMES[m2_name]
                year = int(between_match.group(3)) if between_match.group(3) else anchor_date.year
                start = date(year, m1, 1)
                # end is after m2 month
                if m2 == 12:
                    end = date(year + 1, 1, 1)
                else:
                    end = date(year, m2 + 1, 1)
                label = f"{calendar.month_name[m1]} – {calendar.month_name[m2]} {year}"
                return ResolvedDateInterval(start_date=start, end_date=end, label=label)

        # 10. Direct ISO dates "YYYY-MM-DD to YYYY-MM-DD"
        iso_range_match = re.match(r"^(\d{4}-\d{2}-\d{2})\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2})$", s)
        if iso_range_match:
            try:
                start = datetime.strptime(iso_range_match.group(1), "%Y-%m-%d").date()
                end = datetime.strptime(iso_range_match.group(2), "%Y-%m-%d").date() + timedelta(days=1)
                label = f"{start} to {iso_range_match.group(2)}"
                return ResolvedDateInterval(start_date=start, end_date=end, label=label)
            except ValueError:
                pass

        return None
