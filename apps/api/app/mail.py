"""Pluggable outbound mail transport.

Supports, via configuration only (no per-environment code branching):

- Unauthenticated SMTP relay (default; e.g. local Mailpit catcher, or a
  legacy internal open relay).
- Authenticated SMTP relay (SMTP AUTH + STARTTLS/implicit TLS), for
  providers such as Exchange Online/M365 SMTP AUTH, SendGrid, Mailgun, etc.
- Private authenticated relay: identical to the authenticated-SMTP path
  above; the only difference is that the relay endpoint is reachable
  solely over a private network path (VNet integration/private endpoint),
  which is an infrastructure concern, not an application one.

Azure Communication Services Email is intentionally not used here: ACS
(including ACS Email) is being retired, so it is not a supported target.
"""

from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from typing import Protocol

from app.config import Settings


@dataclass(frozen=True)
class MailMessage:
    """A plain-text email message to be delivered by a MailSender."""

    to: str
    subject: str
    body: str
    sender: str


class MailSender(Protocol):
    """Transport-agnostic mail sending interface.

    Only an SMTP-backed implementation exists today, but call sites depend
    on this protocol rather than smtplib directly so additional providers
    can be added later without changing the worker code.
    """

    def send(self, message: MailMessage) -> None: ...


class SmtpMailSender:
    """Sends mail over SMTP, with optional STARTTLS/implicit TLS and AUTH.

    Behavior is selected entirely by `Settings.mail_auth_mode` /
    `Settings.mail_tls_mode`:

    - auth_mode="none", tls_mode="none": plaintext, unauthenticated (the
      historical default, e.g. Mailpit).
    - auth_mode="basic", tls_mode="starttls": SMTP AUTH over a connection
      upgraded with STARTTLS (typical for M365 SMTP AUTH, SendGrid, Mailgun,
      and most authenticated/private relays).
    - auth_mode="basic", tls_mode="smtps": SMTP AUTH over implicit TLS
      (SMTPS, typically port 465).
    """

    def __init__(
        self,
        *,
        host: str,
        port: int,
        auth_mode: str,
        tls_mode: str,
        username: str | None,
        password: str | None,
        timeout: float = 10,
    ) -> None:
        self._host = host
        self._port = port
        self._auth_mode = auth_mode
        self._tls_mode = tls_mode
        self._username = username
        self._password = password
        self._timeout = timeout

    def send(self, message: MailMessage) -> None:
        from email.message import EmailMessage

        email = EmailMessage()
        email["From"] = message.sender
        email["To"] = message.to
        email["Subject"] = message.subject
        email.set_content(message.body)

        if self._tls_mode == "smtps":
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(
                self._host, self._port, timeout=self._timeout, context=context
            ) as client:
                self._authenticate(client)
                client.send_message(email)
            return

        with smtplib.SMTP(self._host, self._port, timeout=self._timeout) as client:
            if self._tls_mode == "starttls":
                context = ssl.create_default_context()
                client.starttls(context=context)
            self._authenticate(client)
            client.send_message(email)

    def _authenticate(self, client: smtplib.SMTP) -> None:
        if self._auth_mode == "basic":
            client.login(self._username or "", self._password or "")


def get_mail_sender(settings: Settings) -> MailSender:
    """Build the configured MailSender for the given settings."""
    return SmtpMailSender(
        host=settings.smtp_host,
        port=settings.smtp_port,
        auth_mode=settings.mail_auth_mode,
        tls_mode=settings.mail_tls_mode,
        username=settings.smtp_username,
        password=settings.smtp_password,
    )
