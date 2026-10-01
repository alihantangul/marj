from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API_DIR = ROOT / "services" / "api"
WEB_DIR = ROOT / "apps" / "web"
PYTHON = API_DIR / ".venv" / "Scripts" / "python.exe"


def main() -> int:
    if not PYTHON.exists():
        print("API sanal ortamı bulunamadı. README içindeki kurulum adımlarını çalıştırın.")
        return 1

    processes = [
        subprocess.Popen(
            [
                str(PYTHON),
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
                "--reload",
            ],
            cwd=API_DIR,
        ),
        subprocess.Popen(
            ["npm.cmd", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000"],
            cwd=WEB_DIR,
        ),
    ]

    print("Marj web: http://127.0.0.1:3000")
    print("Marj API: http://127.0.0.1:8000/docs")
    print("Durdurmak için Ctrl+C kullanın.")

    try:
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    return next((process.returncode for process in processes if process.returncode), 0)


if __name__ == "__main__":
    sys.exit(main())
