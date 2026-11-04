"""Time contract: database timestamps are UTC; blueprint wall times use the task zone."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def as_utc(value: datetime | None, naive_zone: str = "UTC") -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo(naive_zone))
    return value.astimezone(timezone.utc)


def iso_utc(value: datetime | None) -> str | None:
    value = as_utc(value)
    return value.isoformat() if value else None
