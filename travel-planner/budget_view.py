"""Legacy response shape backed exclusively by the canonical exact-money ledger."""
from decimal import Decimal
from database import session_scope
from models import SavedTrip
from ledger import summary
from money import minor


def saved_budget(owner_id, trip):
    with session_scope() as db:
        row = db.get(SavedTrip, int(trip["id"]))
        if not row or row.user_id != owner_id:
            raise ValueError("Saved trip not found.")
        ledger = summary(db, row)
    scale = Decimal(10) ** ledger["exponent"]
    # JSON numbers remain compatible with old clients; arithmetic above uses minor units.
    def display(value): return float(Decimal(value) / scale)
    payments = [item for item in ledger["records"] if item["kind"] == "expense"]
    names = {item["id"]: item.get("name", "Member") for item in ledger["records"] if item["kind"] == "member"}
    planned, actual = {}, {}
    for item in (trip.get("structuredItinerary") or {}).get("budget_categories", []):
        try:
            category = str(item.get("category", "Other"))
            planned[category] = planned.get(category, 0) + minor(item.get("amount"), ledger["currency"])
        except ValueError:
            continue
    for item in payments:
        category = item.get("category", "Other")
        actual[category] = actual.get(category, 0) + item["amount_minor"]
    alerts = list(ledger["warnings"])
    if ledger["spendable_remaining_minor"] < 0:
        alerts.append("Expected costs exceed the reserve-safe budget.")
    if ledger["paid_minor"] > ledger["budget_minor"]:
        alerts.append("Recorded payments exceed the trip budget.")
    return {"currency": ledger["currency"], "budget": display(ledger["budget_minor"]),
        "committed": display(ledger["confirmed_minor"]), "actual": display(ledger["paid_minor"]),
        "forecast": display(ledger["expected_minor"]), "reserve": display(ledger["reserve_minor"]),
        "spendable": display(ledger["budget_minor"] - ledger["reserve_minor"]),
        "remaining": display(ledger["budget_remaining_minor"]), "reserve_percent": float(ledger["reserve_percent"]),
        "status": "over_budget" if ledger["paid_minor"] > ledger["budget_minor"] else "watch" if alerts else "on_track",
        "alerts": alerts, "ledger": ledger,
        "breakdown": [{"category": name, "planned": display(planned.get(name, 0)), "actual": display(actual.get(name, 0)), "variance": display(planned.get(name, 0) - actual.get(name, 0))} for name in sorted(set(planned) | set(actual))],
        "expenses": [{**item, "amount": display(item["amount_minor"]), "paid_by": names.get(item.get("paid_by_id"), "Member")} for item in payments]}
