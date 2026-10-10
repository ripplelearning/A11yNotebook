"""Generate the original MIT-licensed bundled chime using only Python's standard library."""
import math
import struct
import wave
from pathlib import Path

destination = Path(__file__).resolve().parent.parent / "src/assets/reminder-gentle-chime.wav"
with wave.open(str(destination), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(22050)
    output.writeframes(
        b"".join(
            struct.pack(
                "<h",
                int(
                    9000
                    * math.sin(2 * math.pi * (660 if index < 6615 else 880) * index / 22050)
                    * math.sin(math.pi * (index % 6615) / 6615) ** 2
                ),
            )
            for index in range(13230)
        )
    )
