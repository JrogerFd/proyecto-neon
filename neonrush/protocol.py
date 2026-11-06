"""Protocolo de aplicación: mensajes JSON delimitados por salto de línea (NDJSON).

El transporte es TCP. Cada mensaje es un objeto JSON de una sola línea. El
canal es seguro para enviar desde varios hilos (send_lock) y expone una
recepción bloqueante con timeout que no altera el timeout global del socket.
"""

from __future__ import annotations

import json
import select
import socket
import threading
from enum import Enum
from typing import Any

from .config import MAX_MESSAGE_BYTES


class ProtocolError(Exception):
    """Mensaje malformado o demasiado grande."""


class ConnectionClosed(Exception):
    """El par remoto cerró la conexión."""


class ChannelTimeout(Exception):
    """No llegó ningún mensaje dentro del timeout indicado."""


class Msg(str, Enum):
    HELLO = "HELLO"
    WELCOME = "WELCOME"
    READY = "READY"
    ROOM_STATUS = "ROOM_STATUS"
    START = "START"
    INPUT = "INPUT"
    SNAPSHOT = "SNAPSHOT"
    FINISH = "FINISH"
    ERROR = "ERROR"
    BYE = "BYE"
    PING = "PING"
    PONG = "PONG"


def encode(message: dict[str, Any]) -> bytes:
    try:
        body = json.dumps(
            message,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"mensaje no serializable: {exc}") from exc
    return body.encode("utf-8") + b"\n"


def decode_line(line: bytes) -> dict[str, Any]:
    try:
        message = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError(f"JSON inválido: {exc}") from exc
    if not isinstance(message, dict):
        raise ProtocolError("el mensaje debe ser un objeto JSON")
    return message


class JsonChannel:
    """Canal NDJSON sobre un socket TCP."""

    def __init__(self, sock: socket.socket) -> None:
        self._sock = sock
        self._buffer = b""
        self._send_lock = threading.Lock()
        self._close_lock = threading.Lock()
        self._closed = threading.Event()
        self._socket_closed = False

    @property
    def closed(self) -> bool:
        return self._closed.is_set()

    @property
    def peer(self) -> str:
        try:
            host, port = self._sock.getpeername()[:2]
            return f"{host}:{port}"
        except OSError:
            return "desconocido"

    def send(self, message: dict[str, Any]) -> None:
        if self._closed.is_set():
            raise ConnectionClosed("canal cerrado")
        payload = encode(message)
        with self._send_lock:
            try:
                self._sock.sendall(payload)
            except OSError as exc:
                self._closed.set()
                raise ConnectionClosed(str(exc)) from exc

    def recv(self, timeout: float | None = None) -> dict[str, Any]:
        while True:
            newline = self._buffer.find(b"\n")
            if newline >= 0:
                if newline > MAX_MESSAGE_BYTES:
                    raise ProtocolError("mensaje excede MAX_MESSAGE_BYTES")
                line = self._buffer[:newline]
                self._buffer = self._buffer[newline + 1 :]
                if not line.strip():
                    continue
                return decode_line(line)

            if len(self._buffer) > MAX_MESSAGE_BYTES:
                raise ProtocolError("mensaje excede MAX_MESSAGE_BYTES")

            try:
                readable, _, _ = select.select([self._sock], [], [], timeout)
            except (OSError, ValueError) as exc:
                raise ConnectionClosed(str(exc)) from exc
            if not readable:
                raise ChannelTimeout()

            try:
                chunk = self._sock.recv(65536)
            except socket.timeout:
                raise ChannelTimeout() from None
            except OSError as exc:
                raise ConnectionClosed(str(exc)) from exc
            if not chunk:
                self._closed.set()
                raise ConnectionClosed("EOF")
            self._buffer += chunk

    def close(self) -> None:
        with self._close_lock:
            if self._socket_closed:
                return
            self._socket_closed = True
        self._closed.set()
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self._sock.close()
        except OSError:
            pass


def make_message(kind: Msg, **payload: Any) -> dict[str, Any]:
    return {"type": kind.value, **payload}
