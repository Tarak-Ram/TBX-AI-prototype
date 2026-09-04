from datetime import date
from app.finance.date_resolver import DateResolver

ANCHOR = date(2026, 9, 4)

def test_resolve_last_month():
    interval = DateResolver.resolve("last month", anchor=ANCHOR)
    assert interval is not None
    assert interval.start_date == date(2026, 8, 1)
    assert interval.end_date == date(2026, 9, 1)
    assert interval.label == "August 2026"

def test_resolve_this_month():
    interval = DateResolver.resolve("this month", anchor=ANCHOR)
    assert interval is not None
    assert interval.start_date == date(2026, 9, 1)
    assert interval.end_date == date(2026, 10, 1)

def test_resolve_named_month():
    interval = DateResolver.resolve("August 2026", anchor=ANCHOR)
    assert interval is not None
    assert interval.start_date == date(2026, 8, 1)
    assert interval.end_date == date(2026, 9, 1)

def test_resolve_quarter():
    interval = DateResolver.resolve("Q2", anchor=ANCHOR)
    assert interval is not None
    assert interval.start_date == date(2026, 4, 1)
    assert interval.end_date == date(2026, 7, 1)

def test_resolve_between_months():
    interval = DateResolver.resolve("between January and March", anchor=ANCHOR)
    assert interval is not None
    assert interval.start_date == date(2026, 1, 1)
    assert interval.end_date == date(2026, 4, 1)

def test_resolve_last_30_days():
    interval = DateResolver.resolve("last 30 days", anchor=ANCHOR)
    assert interval is not None
    assert (interval.end_date - interval.start_date).days == 31
