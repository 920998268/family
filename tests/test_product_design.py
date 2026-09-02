import unittest
from pathlib import Path


class ProductDesignDocumentTests(unittest.TestCase):
    def setUp(self):
        self.document_path = Path(__file__).resolve().parents[1] / "docs" / "product-design.md"

    def test_document_exists(self):
        self.assertTrue(self.document_path.exists())

    def test_document_is_not_empty(self):
        self.assertGreater(self.document_path.stat().st_size, 0)

    def test_document_contains_required_sections(self):
        content = self.document_path.read_text(encoding="utf-8")
        required_sections = [
            "产品概述",
            "产品目标",
            "功能范围",
            "运动健身、饮食打卡记录",
            "学习计划打卡记录",
            "家庭每日食谱制定与执行并记录",
            "出行计划制定与执行并记录",
            "家庭支出与收入记录",
            "个人信息",
            "信息架构与导航",
            "核心数据模型",
            "非目标功能",
            "后续迭代方向",
        ]

        for section in required_sections:
            with self.subTest(section=section):
                self.assertIn(section, content)


if __name__ == "__main__":
    unittest.main()
