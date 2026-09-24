from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.config import Settings
from app.mail import MailMessage, SmtpMailSender, get_mail_sender


def make_settings(**overrides: object) -> Settings:
    return Settings(**overrides)  # type: ignore[arg-type]


def test_get_mail_sender_builds_smtp_sender_from_settings() -> None:
    settings = make_settings(
        SMTP_HOST="relay.example.com",
        SMTP_PORT=587,
        MAIL_AUTH_MODE="basic",
        MAIL_TLS_MODE="starttls",
        SMTP_USERNAME="svc-account",
        SMTP_PASSWORD="secret",
    )
    sender = get_mail_sender(settings)
    assert isinstance(sender, SmtpMailSender)
    assert sender._host == "relay.example.com"
    assert sender._port == 587
    assert sender._auth_mode == "basic"
    assert sender._tls_mode == "starttls"
    assert sender._username == "svc-account"
    assert sender._password == "secret"


def test_smtp_mail_sender_unauthenticated_plaintext_default() -> None:
    """Default mode (none/none) must reproduce the historical unauthenticated behavior."""
    sender = SmtpMailSender(
        host="127.0.0.1",
        port=1025,
        auth_mode="none",
        tls_mode="none",
        username=None,
        password=None,
    )
    fake_client = MagicMock()
    with patch("smtplib.SMTP") as smtp_cls:
        smtp_cls.return_value.__enter__.return_value = fake_client
        sender.send(
            MailMessage(
                to="owner@example.com",
                subject="Subject",
                body="Body",
                sender="from@example.com",
            )
        )

    smtp_cls.assert_called_once_with("127.0.0.1", 1025, timeout=10)
    fake_client.starttls.assert_not_called()
    fake_client.login.assert_not_called()
    fake_client.send_message.assert_called_once()


def test_smtp_mail_sender_starttls_with_basic_auth() -> None:
    sender = SmtpMailSender(
        host="smtp.office365.com",
        port=587,
        auth_mode="basic",
        tls_mode="starttls",
        username="svc-account",
        password="secret",
    )
    fake_client = MagicMock()
    with patch("smtplib.SMTP") as smtp_cls:
        smtp_cls.return_value.__enter__.return_value = fake_client
        sender.send(
            MailMessage(
                to="owner@example.com",
                subject="Subject",
                body="Body",
                sender="from@example.com",
            )
        )

    fake_client.starttls.assert_called_once()
    fake_client.login.assert_called_once_with("svc-account", "secret")
    fake_client.send_message.assert_called_once()


def test_smtp_mail_sender_implicit_tls_with_basic_auth() -> None:
    sender = SmtpMailSender(
        host="smtp.sendgrid.net",
        port=465,
        auth_mode="basic",
        tls_mode="smtps",
        username="apikey",
        password="secret",
    )
    fake_client = MagicMock()
    with patch("smtplib.SMTP_SSL") as smtp_ssl_cls:
        smtp_ssl_cls.return_value.__enter__.return_value = fake_client
        sender.send(
            MailMessage(
                to="owner@example.com",
                subject="Subject",
                body="Body",
                sender="from@example.com",
            )
        )

    smtp_ssl_cls.assert_called_once()
    fake_client.login.assert_called_once_with("apikey", "secret")
    fake_client.send_message.assert_called_once()


def test_smtp_mail_sender_private_relay_is_authenticated_smtp_over_configured_host() -> None:
    """A 'private authenticated relay' is just authenticated SMTP pointed at a
    host only reachable over a private network path (VNet/private endpoint);
    no distinct application code path is required."""
    sender = SmtpMailSender(
        host="mail-relay.internal.corp",
        port=587,
        auth_mode="basic",
        tls_mode="starttls",
        username="svc-account",
        password="secret",
    )
    fake_client = MagicMock()
    with patch("smtplib.SMTP") as smtp_cls:
        smtp_cls.return_value.__enter__.return_value = fake_client
        sender.send(
            MailMessage(
                to="owner@example.com",
                subject="Subject",
                body="Body",
                sender="from@example.com",
            )
        )

    smtp_cls.assert_called_once_with("mail-relay.internal.corp", 587, timeout=10)
    fake_client.starttls.assert_called_once()
    fake_client.login.assert_called_once_with("svc-account", "secret")
