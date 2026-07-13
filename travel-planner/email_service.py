from __future__ import annotations

import html as html_lib
import logging
import smtplib
from email.message import EmailMessage

from config import settings


logger = logging.getLogger(__name__)


def notify_admin_pending_user(name: str, email: str) -> None:
    if not settings.admin_notification_email:
        logger.info("Pending account requires approval", extra={"pending_email": email})
        return
    admin_url = f"{settings.frontend_origin}/?admin_panel=1"
    safe_name = html_lib.escape(name)
    safe_email = html_lib.escape(email)
    plain, html_body = _build_email(
        intro_text=f"{name} ({email}) registered and is awaiting approval.",
        intro_html=f"<strong>{safe_name}</strong> ({safe_email}) registered and is awaiting your approval.",
        button_label="Open Admin Panel",
        button_url=admin_url,
    )
    _send(settings.admin_notification_email, "Wanderful account awaiting approval", plain, html_body)


def send_password_reset(email: str, token: str) -> None:
    reset_url = f"{settings.frontend_origin}/?reset_token={token}"
    plain, html_body = _build_email(
        intro_text="Reset your Wanderful password within 30 minutes.",
        intro_html="Reset your Wanderful password. This link expires in 30 minutes.",
        button_label="Reset Password",
        button_url=reset_url,
    )
    _send(email, "Reset your Wanderful password", plain, html_body)


def send_plan_ready(email: str, job_id: str, destination: str) -> None:
    trip_url = f"{settings.frontend_origin}/?job_id={job_id}"
    safe_destination = html_lib.escape(destination)
    plain, html_body = _build_email(
        intro_text=f"Your {destination} itinerary is ready to view.",
        intro_html=f"Your <strong>{safe_destination}</strong> itinerary is ready.",
        button_label="View Your Trip",
        button_url=trip_url,
    )
    _send(email, f"Your {destination} itinerary is ready", plain, html_body)


def _build_email(intro_text: str, intro_html: str, button_label: str, button_url: str) -> tuple[str, str]:
    plain = f"{intro_text}\n\n{button_label}: {button_url}\n"
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
      <h2 style="margin:0 0 16px;font-size:20px;">Wanderful</h2>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">{intro_html}</p>
      <p style="margin:0;">
        <a href="{button_url}" style="display:inline-block;background:#111111;color:#ffffff;
          text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">
          {button_label}
        </a>
      </p>
    </div>
    """
    return plain, html_body


def _send(recipient: str, subject: str, body: str, html_body: str | None = None) -> None:
    if not settings.smtp_host:
        logger.warning("SMTP not configured; email was not sent", extra={"recipient": recipient, "subject": subject})
        return
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from_email or settings.admin_notification_email or settings.smtp_username
    message["To"] = recipient
    message.set_content(body)
    if html_body:
        message.add_alternative(html_body, subtype="html")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except Exception:
        # A notification email is a side effect, not the request itself - never let an SMTP
        # hiccup (bad sender, auth failure, timeout) turn registration/password-reset into a 500.
        logger.exception("Failed to send email", extra={"recipient": recipient, "subject": subject})
