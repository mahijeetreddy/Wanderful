"""Owner-managed, exact trip ledger. Settlements never count as additional spending."""
import uuid
from copy import deepcopy
from sqlalchemy import select
from models import TripRecord, TripSelection, OfferSnapshot
from money import minor, offer_minor, exponent


def records(db, trip_id):
    return [{"id": row.id, "kind": row.kind, **deepcopy(row.payload)} for row in db.scalars(select(TripRecord).where(TripRecord.trip_id == trip_id)).all()]


def legacy_records(trip):
    """Deterministic import view. Invalid legacy data is preserved with an explicit warning."""
    state = trip.budget_state_json or {}
    currency = (trip.form_json or {}).get("currency_code", "USD")
    names = list(dict.fromkeys([*(state.get("members") or []), *[e.get("paid_by", "Me") for e in state.get("expenses", []) if isinstance(e, dict)]])) or ["Me"]
    result = []
    member_ids = {name: "member-" + uuid.uuid5(uuid.NAMESPACE_URL, f"{trip.id}:{name}").hex for name in names if isinstance(name, str)}
    for name, identity in member_ids.items():
        result.append({"id": identity, "kind": "member", "name": name})
    for kind, source in (("expense", state.get("expenses", [])), ("settlement", state.get("settlements", []))):
        for index, item in enumerate(source):
            if not isinstance(item, dict):
                continue
            identity = f"legacy-{kind}-" + uuid.uuid5(uuid.NAMESPACE_URL, f"{trip.id}:{index}:{item.get('id', '')}").hex
            try:
                value = {"id": identity, "kind": kind, "amount_minor": minor(item.get("amount"), currency), "currency": currency, "label": item.get("label", "Legacy record"), "category": item.get("category", "Other"), "occurred_at": item.get("occurred_at", "")}
                if kind == "expense":
                    split = item.get("split_between") or names[:max(1, int(item.get("split_count") or 1))]
                    value.update(paid_by_id=member_ids[item.get("paid_by", "Me")], split_ids=[member_ids[name] for name in split])
                else:
                    value.update(from_id=member_ids[item["from"]], to_id=member_ids[item["to"]])
                result.append(value)
            except (ValueError, KeyError, TypeError):
                result.append({"id": identity, "kind": "legacy_unresolved", "original": deepcopy(item), "warning": "Legacy amount or member identity needs review; not included in totals."})
    return result


def ensure_imported(db, trip):
    if db.get(TripRecord, (trip.id, "legacy-import")):
        return
    for item in legacy_records(trip):
        data = dict(item); identity = data.pop("id"); kind = data.pop("kind")
        db.add(TripRecord(trip_id=trip.id, id=identity, kind=kind, payload=data))
    db.add(TripRecord(trip_id=trip.id, id="legacy-import", kind="migration", payload={"currency": (trip.form_json or {}).get("currency_code", "USD")}))
    db.flush()


def current_records(db, trip):
    values = records(db, trip.id)
    return values if any(item["id"] == "legacy-import" for item in values) else legacy_records(trip) + values


def commitments(db, trip):
    currency = (trip.form_json or {}).get("currency_code", "USD")
    result = []
    for selection in db.scalars(select(TripSelection).where(TripSelection.trip_id == trip.id)).all():
        if selection.status != "externally_booked":
            continue
        snapshot = db.get(OfferSnapshot, selection.snapshot_id)
        amount = offer_minor(snapshot.offer if snapshot else None, currency)
        result.append({"id": "booking-" + selection.kind, "kind": "commitment", "label": "User-recorded " + selection.kind, "category": "Flights" if selection.kind == "flights" else "Hotels", "amount_minor": amount, "currency": currency, "snapshot_id": selection.snapshot_id})
    return result


def balances(values):
    result = {item["id"]: 0 for item in values if item["kind"] == "member"}
    for item in values:
        if item["kind"] == "expense":
            split = sorted(set(item.get("split_ids", [])))
            if not split or item.get("paid_by_id") not in result or any(identity not in result for identity in split):
                continue
            result[item["paid_by_id"]] += item["amount_minor"]
            share, remainder = divmod(item["amount_minor"], len(split))
            for index, identity in enumerate(split):
                result[identity] -= share + int(index < remainder)
        elif item["kind"] == "settlement" and item.get("from_id") in result and item.get("to_id") in result:
            result[item["from_id"]] += item["amount_minor"]
            result[item["to_id"]] -= item["amount_minor"]
    return result


def summary(db, trip, *, structured=None):
    currency = (trip.form_json or {}).get("currency_code", "USD")
    precision = exponent(currency)
    values = current_records(db, trip)
    booked = commitments(db, trip) + [item for item in values if item["kind"] == "commitment"]
    payments = [item for item in values if item["kind"] == "expense"]
    planned = {}
    unknown = [item.get("warning") for item in values if item["kind"] == "legacy_unresolved"]
    for item in (structured if structured is not None else trip.structured_json or {}).get("budget_categories", []):
        try:
            category = str(item.get("category", "Other"))
            planned[category] = planned.get(category, 0) + minor(item.get("amount"), currency)
        except ValueError:
            unknown.append("A planned cost is unknown or has unsupported precision.")
    confirmed = sum(item["amount_minor"] or 0 for item in booked)
    linked = {}
    for payment in payments:
        if payment.get("commitment_id"):
            linked[payment["commitment_id"]] = linked.get(payment["commitment_id"], 0) + payment["amount_minor"]
    categories = set(planned) | {item.get("category", "Other") for item in booked + payments}
    expected = 0
    for category in categories:
        category_booked = [item for item in booked if item.get("category", "Other") == category]
        committed = sum(max(item["amount_minor"] or 0, linked.get(item["id"], 0)) for item in category_booked)
        unlinked = sum(item["amount_minor"] for item in payments if item.get("category", "Other") == category and not item.get("commitment_id"))
        expected += max(planned.get(category, 0), committed + unlinked)
    actual = sum(item["amount_minor"] for item in payments)
    for item in booked:
        if item["amount_minor"] is None:
            unknown.append(f"Confirmed cost unknown: {item['label']}.")
    budget = minor((trip.form_json or {}).get("budget") or 0, currency)
    return {"currency": currency, "exponent": precision, "budget_minor": budget, "planned_minor": sum(planned.values()), "confirmed_minor": confirmed, "paid_minor": actual, "expected_minor": expected, "remaining_expected_minor": max(0, expected - actual), "budget_remaining_minor": budget - expected, "warnings": unknown, "records": values, "commitments": booked, "balances": balances(values), "revision": trip.revision}


def validate_record(db, trip, kind, body):
    currency = (trip.form_json or {}).get("currency_code", "USD")
    if kind == "member":
        name = str(body.get("name", "")).strip()[:100]
        if not name:
            raise ValueError("A member name is required.")
        return {"name": name}
    if kind not in {"expense", "settlement", "commitment"}:
        raise ValueError("Unsupported record kind.")
    if body.get("currency") != currency:
        raise ValueError("Use the trip currency. No foreign exchange conversion is performed.")
    amount = minor(body.get("amount"), currency)
    if amount <= 0:
        raise ValueError("Amount must be positive.")
    value = {"amount_minor": amount, "currency": currency, "label": str(body.get("label", ""))[:160], "category": str(body.get("category", "Other"))[:60], "occurred_at": str(body.get("occurred_at", ""))[:30]}
    values = current_records(db, trip)
    members = {item["id"] for item in values if item["kind"] == "member"}
    if kind == "expense":
        split = body.get("split_ids")
        payer = body.get("paid_by_id")
        if not isinstance(split, list) or not split or any(not isinstance(identity, str) or identity not in members for identity in split) or payer not in members:
            raise ValueError("Choose existing members for payer and split.")
        value.update(paid_by_id=payer, split_ids=sorted(set(split)))
        if body.get("commitment_id"):
            commitment = next((item for item in commitments(db, trip) + values if item["id"] == body["commitment_id"] and item["kind"] == "commitment"), None)
            if not commitment:
                raise ValueError("Commitment not found in this trip.")
            value.update(commitment_id=commitment["id"], category=commitment["category"])
    elif kind == "settlement":
        sender, receiver = body.get("from_id"), body.get("to_id")
        if sender not in members or receiver not in members or sender == receiver:
            raise ValueError("Choose two different existing members.")
        owed = balances(values)
        if amount > min(-owed[sender], owed[receiver]):
            raise ValueError("Settlement exceeds the current outstanding balance.")
        value.update(from_id=sender, to_id=receiver)
    return value
