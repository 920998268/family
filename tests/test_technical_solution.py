import unittest
from pathlib import Path


class TechnicalSolutionDocumentTests(unittest.TestCase):
    def setUp(self):
        self.document_path = (
            Path(__file__).resolve().parents[1] / "docs" / "technical-solution.md"
        )

    def test_document_exists(self):
        self.assertTrue(self.document_path.exists())

    def test_document_is_not_empty(self):
        self.assertGreater(self.document_path.stat().st_size, 0)

    def test_document_contains_required_sections(self):
        content = self.document_path.read_text(encoding="utf-8")
        required_sections = [
            "技术选型",
            "总体架构",
            "数据存储",
            "功能模块",
            "项目结构",
            "测试策略",
            "发布策略",
            "里程碑",
            "风险与应对",
            "MVP 技术边界",
        ]

        for section in required_sections:
            with self.subTest(section=section):
                self.assertIn(section, content)


if __name__ == "__main__":
    unittest.main()
