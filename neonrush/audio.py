"""Sintetizador procedural de música y efectos para el OASIS.

No requiere archivos de audio ni numpy: genera ondas PCM con la biblioteca
estándar y las entrega a ``pygame.mixer``. Si el mixer no está disponible
(servidor headless, sin tarjeta de sonido), el módulo se desactiva solo.
"""

from __future__ import annotations

import array
import io
import math
import random
import wave
from functools import lru_cache
from typing import Any

SAMPLE_RATE = 22050


def _saw(phase: float) -> float:
    return 2.0 * (phase - math.floor(phase + 0.5))


def _square(phase: float) -> float:
    return 1.0 if (phase % 1.0) < 0.5 else -1.0


def _note(frequency: float, duration: float, volume: float, kind: str = "sine") -> list[float]:
    count = int(SAMPLE_RATE * duration)
    result: list[float] = []
    for index in range(count):
        t = index / SAMPLE_RATE
        phase = frequency * t
        if kind == "saw":
            value = _saw(phase)
        elif kind == "square":
            value = _square(phase)
        else:
            value = math.sin(math.tau * phase)
        attack = min(1.0, index / max(1, int(SAMPLE_RATE * 0.008)))
        release = min(1.0, (count - index) / max(1, int(SAMPLE_RATE * 0.03)))
        result.append(value * volume * attack * release)
    return result


def _wav_bytes(samples: list[float]) -> bytes:
    pcm = array.array("h")
    for value in samples:
        clamped = max(-1.0, min(1.0, value))
        pcm.append(int(clamped * 32767))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm.tobytes())
    return buffer.getvalue()


@lru_cache(maxsize=1)
def _synthwave_loop() -> bytes:
    bpm = 104.0
    beat = 60.0 / bpm
    beats = 16
    total = int(SAMPLE_RATE * beat * beats)
    samples = [0.0] * total
    rng = random.Random(88)
    bass_notes = (55.0, 65.41, 49.0, 58.27)
    chord_notes = (
        (220.0, 261.63, 329.63),
        (261.63, 329.63, 392.0),
        (196.0, 246.94, 293.66),
        (233.08, 293.66, 349.23),
    )
    arp = (440.0, 523.25, 659.25, 523.25, 392.0, 523.25, 659.25, 783.99)

    for index in range(total):
        t = index / SAMPLE_RATE
        beat_index = int(t / beat)
        local = t - beat_index * beat
        bar = (beat_index // 4) % 4
        value = 0.0

        bass_freq = bass_notes[bar]
        value += _saw(bass_freq * t) * 0.18 * max(0.0, 1.0 - local / beat)
        value += math.sin(math.tau * bass_freq * 0.5 * t) * 0.10

        step = int(t / (beat * 0.5))
        arp_freq = arp[step % len(arp)]
        step_local = t - step * beat * 0.5
        arp_phase = arp_freq * t
        value += _square(arp_phase) * 0.045 * max(
            0.0, 1.0 - step_local / (beat * 0.45)
        )

        for chord_freq in chord_notes[bar]:
            value += math.sin(math.tau * chord_freq * t) * 0.018

        kick_local = local % (beat * 0.5)
        if kick_local < 0.12:
            envelope = math.exp(-kick_local * 26.0)
            value += math.sin(math.tau * (54.0 - kick_local * 90.0) * t) * 0.30 * envelope
        if local > beat * 0.72:
            noise = rng.uniform(-1.0, 1.0)
            value += noise * 0.018 * max(0.0, (beat - local) / (beat * 0.28))

        samples[index] = value * 0.7
    return _wav_bytes(samples)


@lru_cache(maxsize=1)
def _sfx_click() -> bytes:
    samples: list[float] = []
    for index in range(int(SAMPLE_RATE * 0.065)):
        t = index / SAMPLE_RATE
        freq = 1180.0 - t * 7200.0
        envelope = math.exp(-t * 48.0)
        samples.append(math.sin(math.tau * freq * t) * 0.22 * envelope)
    return _wav_bytes(samples)


@lru_cache(maxsize=1)
def _sfx_hover() -> bytes:
    samples: list[float] = []
    for index in range(int(SAMPLE_RATE * 0.045)):
        t = index / SAMPLE_RATE
        envelope = math.exp(-t * 60.0)
        samples.append(math.sin(math.tau * 1760.0 * t) * 0.10 * envelope)
    return _wav_bytes(samples)


@lru_cache(maxsize=1)
def _sfx_confirm() -> bytes:
    samples: list[float] = []
    for note_index, frequency in enumerate((392.0, 523.25, 783.99)):
        samples.extend(_note(frequency, 0.11, 0.16, "square"))
    return _wav_bytes(samples)


@lru_cache(maxsize=1)
def _sfx_start() -> bytes:
    samples: list[float] = []
    duration = 0.65
    for index in range(int(SAMPLE_RATE * duration)):
        t = index / SAMPLE_RATE
        freq = 180.0 + (t / duration) ** 0.7 * 1100.0
        envelope = min(1.0, t / 0.08) * max(0.0, 1.0 - t / duration)
        value = math.sin(math.tau * freq * t) * 0.16 * envelope
        value += _saw(freq * 1.5 * t) * 0.05 * envelope
        samples.append(value)
    return _wav_bytes(samples)


class SynthAudio:
    def __init__(self, enabled: bool = True) -> None:
        self.pygame: Any = None
        self.enabled = False
        self._sounds: dict[str, Any] = {}
        self._music: Any = None
        self._music_channel: Any = None
        if enabled:
            self.reinit()

    def reinit(self) -> None:
        self.close()
        try:
            import pygame

            self.pygame = pygame
            if pygame.mixer.get_init():
                pygame.mixer.quit()
            pygame.mixer.init(
                frequency=SAMPLE_RATE,
                size=-16,
                channels=1,
                buffer=512,
            )
            pygame.mixer.set_num_channels(8)
            self._music = pygame.mixer.Sound(file=io.BytesIO(_synthwave_loop()))
            self._music.set_volume(0.36)
            self._sounds = {
                "click": pygame.mixer.Sound(file=io.BytesIO(_sfx_click())),
                "hover": pygame.mixer.Sound(file=io.BytesIO(_sfx_hover())),
                "confirm": pygame.mixer.Sound(file=io.BytesIO(_sfx_confirm())),
                "start": pygame.mixer.Sound(file=io.BytesIO(_sfx_start())),
            }
            self.enabled = True
            self.play_music()
        except Exception:  # noqa: BLE001 - audio es opcional
            self.enabled = False
            self.pygame = None
            self._sounds = {}
            self._music = None

    def play_music(self, volume: float = 0.36) -> None:
        if not self.enabled or self._music is None:
            return
        try:
            self._music.set_volume(volume)
            if self._music_channel is None or not self._music_channel.get_busy():
                self._music_channel = self._music.play(loops=-1)
        except Exception:  # noqa: BLE001
            self.enabled = False

    def stop_music(self) -> None:
        if self._music_channel is not None:
            try:
                self._music_channel.stop()
            except Exception:  # noqa: BLE001
                pass
            self._music_channel = None

    def sfx(self, name: str, volume: float = 0.8) -> None:
        if not self.enabled:
            return
        sound = self._sounds.get(name)
        if sound is None:
            return
        try:
            sound.set_volume(volume)
            sound.play()
        except Exception:  # noqa: BLE001
            pass

    def close(self) -> None:
        self.stop_music()
        self._sounds = {}
        self._music = None
        if self.pygame is not None:
            try:
                self.pygame.mixer.quit()
            except Exception:  # noqa: BLE001
                pass
        self.enabled = False
