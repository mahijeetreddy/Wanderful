from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from config import settings


logger = logging.getLogger(__name__)


def notify_admin_pending_user(name: str, email: str) -> None:
    if not settings.admin_notification_email:
        logger.info("Pending account requires approval", extra={"pending_email": email})
        return
    _send(
        settings.admin_notification_email,
        "Wanderful account awaiting approval",
        f"{name} ({email}) registered and is awaiting approval.",
    )


def send_password_reset(email: str, token: str) -> None:
    reset_url = f"{settings.frontend_origin}/?reset_token={token}"
    _send(email, "Reset your Wanderful password", f"Reset your password within 30 minutes:\n{reset_url}")


def _send(recipient: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        logger.warning("SMTP not configured; email was not sent", extra={"recipient": recipient, "subject": subject})
        return
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_username or settings.admin_notification_email
    message["To"] = recipient
    message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)
