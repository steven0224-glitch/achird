"""테스트 러너 — `python run_tests.py` 또는 `run_tests.bat` 더블클릭.

stdlib unittest 만 쓴다(pytest 미설치 전제). `app.py --self-check` 도 여기로 위임되므로
회귀 케이스를 추가할 곳은 tests/ 한 군데뿐이다.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def run(verbosity: int = 2) -> bool:
    """tests/ 전체를 돌리고 성공 여부를 반환한다."""
    sys.path.insert(0, str(ROOT))
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=verbosity, stream=sys.stdout).run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
