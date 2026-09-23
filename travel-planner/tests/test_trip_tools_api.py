from io import BytesIO
from unittest.mock import patch


def _register(client):
    response = client.post("/api/auth/register", json={"name": "Admin", "email": "admin@example.com", "password": "long-password"})
    assert response.status_code == 201


def _trip(client) -> int:
    response = client.post("/api/trips", json={
        "name": "Lisbon group trip",
        "destination": "Lisbon",
        "dateRange": "Oct 8 - Oct 11",
        "form": {"budget": "2400", "currency_code": "USD"},
        "itinerary": "Day 1",
    })
    assert response.status_code == 201
    return int(response.get_json()["trip"]["id"])


def test_group_expenses_preserve_members_splits_and_settlements(client):
    _register(client)
    trip_id = _trip(client)
    response = client.put(f"/api/trips/{trip_id}/budget", json={
        "expected_revision": 1,
        "members": ["Me", "Ava", "Noah"],
        "expenses": [{"id": "dinner", "label": "Dinner", "category": "Food", "amount": 120, "paid_by": "Ava", "split_between": ["Me", "Ava", "Noah"]}],
        "settlements": [{"id": "paid", "from": "Me", "to": "Ava", "amount": 20}],
    })

    assert response.status_code == 200
    state = response.get_json()["trip"]["budgetState"]
    assert state["members"] == ["Me", "Ava", "Noah"]
    assert state["expenses"][0]["split_between"] == ["Me", "Ava", "Noah"]
    assert state["settlements"][0]["amount"] == 20


def test_private_document_upload_download_and_delete(client):
    _register(client)
    trip_id = _trip(client)
    pdf = b"%PDF-1.4\n% test document\n"
    uploaded = client.post(
        f"/api/trips/{trip_id}/documents",
        data={"file": (BytesIO(pdf), "insurance.pdf"), "category": "Insurance", "expires_on": "2027-01-15"},
        content_type="multipart/form-data",
    )
    assert uploaded.status_code == 201
    document = uploaded.get_json()["document"]
    assert document["name"] == "insurance.pdf"
    assert "storage_name" not in document

    listed = client.get(f"/api/trips/{trip_id}/documents")
    assert listed.status_code == 200
    assert listed.get_json()["documents"][0]["category"] == "Insurance"

    downloaded = client.get(f"/api/trips/{trip_id}/documents/{document['id']}/download")
    assert downloaded.status_code == 200
    assert downloaded.data == pdf
    assert downloaded.headers["Cache-Control"] == "private, no-store"
    downloaded.close()

    removed = client.delete(f"/api/trips/{trip_id}/documents/{document['id']}")
    assert removed.status_code == 200, removed.get_json()
    assert client.get(f"/api/trips/{trip_id}/documents/{document['id']}/download").status_code == 404


def test_route_map_resolves_stops_concurrently(client):
    _register(client)
    with patch("places.lookup_place", side_effect=[{"coordinates": {"lat": 38.71, "lng": -9.14}, "source_id": "market"}, {"coordinates": {"lat": 38.72, "lng": -9.13}, "source_id": "viewpoint"}]):
        response = client.post("/api/route-map", json={"destination": "Lisbon", "stops": [
            {"title": "Market", "location": "Time Out Market"},
            {"title": "Viewpoint", "location": "Miradouro da Senhora"},
        ]})
    assert response.status_code == 200
    assert len(response.get_json()["stops"]) == 2
    assert response.get_json()["unresolved"] == 0
