import logging
import socket
import threading
import time
import unittest

from neonrush.config import PROTOCOL_VERSION
from neonrush.master import MasterNode
from neonrush.protocol import JsonChannel, Msg, make_message
from neonrush.worker import WorkerClient

logging.disable(logging.CRITICAL)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def connect(port: int, room: str, name: str) -> JsonChannel:
    deadline = time.monotonic() + 5.0
    while True:
        try:
            sock = socket.create_connection(("127.0.0.1", port), timeout=2.0)
            break
        except OSError:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.05)
    channel = JsonChannel(sock)
    channel.send(
        make_message(
            Msg.HELLO, protocol=PROTOCOL_VERSION, room=room, name=name
        )
    )
    while True:
        message = channel.recv(timeout=5.0)
        if message.get("type") == Msg.WELCOME.value:
            return channel
        if message.get("type") == Msg.ERROR.value:
            raise AssertionError(message.get("reason"))


def wait_for(predicate, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


class DistributedIntegrationTests(unittest.TestCase):
    def test_master_rejects_clients_with_old_track_protocol(self):
        port = free_port()
        master = MasterNode(
            host="127.0.0.1",
            port=port,
            room="PROTOCOL",
            expected_players=1,
            laps=1,
            asset_delay=0.01,
            auto_shutdown=False,
        )
        master.start_background()
        channel = None
        try:
            self.assertTrue(wait_for(lambda: master.assets.ready, 3.0))
            deadline = time.monotonic() + 5.0
            while True:
                try:
                    sock = socket.create_connection(("127.0.0.1", port), timeout=2.0)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.05)
            channel = JsonChannel(sock)
            channel.send(
                make_message(
                    Msg.HELLO,
                    protocol=PROTOCOL_VERSION - 1,
                    room="PROTOCOL",
                    name="OLD-CLIENT",
                )
            )
            response = channel.recv(timeout=3.0)
            self.assertEqual(response.get("type"), Msg.ERROR.value)
            self.assertIn("incompatible", response.get("reason", "").lower())
        finally:
            if channel is not None:
                channel.close()
            master.stop()

    def test_full_master_worker_race(self):
        port = free_port()
        master = MasterNode(
            host="127.0.0.1",
            port=port,
            room="INTEGRATION",
            expected_players=2,
            laps=1,
            asset_delay=0.01,
            auto_shutdown=False,
        )
        master.start_background()
        workers = [
            WorkerClient(
                host="127.0.0.1",
                port=port,
                room="INTEGRATION",
                name=f"IT-{index + 1}",
                render="none",
                autopilot=True,
                duration=40.0,
                asset_delay=0.01,
            )
            for index in range(2)
        ]
        threads = [
            threading.Thread(target=worker.run, daemon=True) for worker in workers
        ]
        for thread in threads:
            thread.start()
        try:
            self.assertTrue(
                master.wait_finished(40.0), "El Master no emitió FINISH"
            )
            results = master.finish_results or []
            self.assertEqual(len(results), 2)
            self.assertTrue(all(result["finished"] for result in results))
            self.assertEqual(results[0]["placement"], 1)
            self.assertTrue(all(worker.error is None for worker in workers))
        finally:
            for worker in workers:
                worker.request_stop()
            master.stop()
            for thread in threads:
                thread.join(timeout=3.0)

    def test_master_waits_for_all_workers_ready(self):
        port = free_port()
        master = MasterNode(
            host="127.0.0.1",
            port=port,
            room="BARRIER",
            expected_players=2,
            laps=1,
            asset_delay=0.01,
            auto_shutdown=False,
        )
        master.start_background()
        first = None
        second = None
        try:
            self.assertTrue(wait_for(lambda: master.assets.ready, 3.0))
            first = connect(port, "BARRIER", "RAW-1")
            first.send(make_message(Msg.READY, done=4, total=4))
            time.sleep(0.25)
            self.assertFalse(
                master.started,
                "No debe largar con un solo Worker listo",
            )

            second = connect(port, "BARRIER", "RAW-2")
            time.sleep(0.15)
            self.assertFalse(
                master.started,
                "No debe largar antes del READY del segundo Worker",
            )
            second.send(make_message(Msg.READY, done=4, total=4))
            self.assertTrue(
                wait_for(lambda: master.started, 3.0),
                "La barrera no se liberó con 2/2 Workers listos",
            )
        finally:
            if first is not None:
                first.close()
            if second is not None:
                second.close()
            master.stop()


if __name__ == "__main__":
    unittest.main()
