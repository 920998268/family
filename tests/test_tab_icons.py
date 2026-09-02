import unittest
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class TabIconAssetsTests(unittest.TestCase):
    def setUp(self):
        self.tabbar_dir = (
            Path(__file__).resolve().parents[1] / "src" / "static" / "tabbar"
        )

    def test_all_expected_icons_exist(self):
        expected = [
            f"{name}-{state}.png"
            for name in ("home", "checkin", "plan", "ledger", "me")
            for state in ("gray", "active")
        ]
        for filename in expected:
            with self.subTest(filename=filename):
                self.assertTrue(
                    (self.tabbar_dir / filename).exists(),
                    f"缺少 Tab 图标: {filename}",
                )

    def test_icons_are_valid_non_empty_png(self):
        for png in self.tabbar_dir.glob("*.png"):
            with self.subTest(filename=png.name):
                data = png.read_bytes()
                self.assertGreater(len(data), 500, f"图标文件过小: {png.name}")
                self.assertEqual(data[:8], PNG_SIGNATURE, f"非法 PNG: {png.name}")


if __name__ == "__main__":
    unittest.main()
