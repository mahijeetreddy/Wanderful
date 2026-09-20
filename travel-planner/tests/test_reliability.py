from unittest.mock import Mock, patch

import pytest

from reliability import increment_metric, provider_call


def test_provider_call_retries_then_succeeds():
    provider = Mock(side_effect=[TimeoutError("slow"), {"ok": True}])

    with patch("reliability.redis_client", return_value=None), patch("reliability.time.sleep") as sleep:
        result = provider_call("weather", provider, retries=1)

    assert result == {"ok": True}
    assert provider.call_count == 2
    sleep.assert_called_once()


def test_provider_call_opens_circuit_after_threshold():
    redis = Mock()
    redis.get.return_value = None
    redis.incr.return_value = 2

    with patch("reliability.redis_client", return_value=redis):
        with pytest.raises(RuntimeError, match="HTTP 503"):
            provider_call("flights", lambda: "HTTP 503 provider unavailable", retries=0, failure_threshold=2)

    redis.setex.assert_called_once_with("wanderful:circuit:flights:open", 60, "1")


def test_provider_call_rejects_requests_while_circuit_is_open():
    redis = Mock()
    redis.get.return_value = "1"
    provider = Mock()

    with patch("reliability.redis_client", return_value=redis):
        with pytest.raises(RuntimeError, match="temporarily open"):
            provider_call("hotels", provider)

    provider.assert_not_called()


def test_successful_provider_call_clears_failure_counter():
    redis = Mock()
    redis.get.return_value = None

    with patch("reliability.redis_client", return_value=redis):
        assert provider_call("local", lambda: "available") == "available"

    redis.delete.assert_called_once_with("wanderful:circuit:local:failures")


def test_increment_metric_sets_retention():
    redis = Mock()

    with patch("reliability.redis_client", return_value=redis):
        increment_metric("provider_success", 3)

    redis.incrby.assert_called_once_with("wanderful:metrics:provider_success", 3)
    redis.expire.assert_called_once_with("wanderful:metrics:provider_success", 7 * 24 * 3600)
