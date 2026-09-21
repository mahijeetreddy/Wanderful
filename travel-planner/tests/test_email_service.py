from unittest.mock import patch

from email_service import notify_admin_pending_user, send_password_reset, send_plan_ready


def test_outbound_email_is_suppressed_in_test_environment():
    with patch("email_service.smtplib.SMTP") as smtp:
        notify_admin_pending_user("Pending User", "pending@example.com")
        send_password_reset("pending@example.com", "test-token")
        send_plan_ready("pending@example.com", "job-1", "Lisbon")

    smtp.assert_not_called()
