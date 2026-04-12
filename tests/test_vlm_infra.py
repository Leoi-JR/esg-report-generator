"""
test_vlm_infra.py
=================
VLM 基础设施纯函数单元测试。

测试 _filter_image / _resize_image_bytes / _to_png_bytes / _parse_vlm_response /
_assemble_image_section_text / configure_vlm_context 等函数。

不依赖 VLM 服务运行，可离线执行。

运行方式：
    conda run -n esg python -m pytest tests/test_vlm_infra.py -v
"""

import os
import sys
import io

# 将 src/ 加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from PIL import Image


# ── 辅助：生成指定尺寸的 PNG 字节 ──────────────────────────────────────────
def _make_png(width: int, height: int, color=(128, 128, 128)) -> bytes:
    """创建指定尺寸的纯色 PNG 图片字节流。"""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_jpeg(width: int, height: int) -> bytes:
    """创建指定尺寸的 JPEG 图片字节流。"""
    img = Image.new("RGB", (width, height), (200, 100, 50))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


# ==============================================================================
# _filter_image 测试
# ==============================================================================

def test_filter_passes_large():
    """足够大的图片应通过过滤。"""
    from extractors import _filter_image
    # 纯色PNG压缩率极高，需要用随机像素确保字节数 > 5KB
    import random
    random.seed(42)
    img = Image.new("RGB", (300, 300))
    pixels = [(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
              for _ in range(300 * 300)]
    img.putdata(pixels)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    big_png = buf.getvalue()
    assert len(big_png) > 5120, f"PNG too small: {len(big_png)} bytes"
    assert _filter_image(big_png, 300, 300) is True


def test_filter_rejects_small_dimension():
    """50×200 图片应被过滤（宽度不足）。"""
    from extractors import _filter_image
    png = _make_png(50, 200)
    assert _filter_image(png, 50, 200) is False


def test_filter_rejects_small_height():
    """200×50 图片应被过滤（高度不足）。"""
    from extractors import _filter_image
    png = _make_png(200, 50)
    assert _filter_image(png, 200, 50) is False


def test_filter_rejects_small_bytes():
    """即使尺寸够大，字节数 < 5KB 也应被过滤。"""
    from extractors import _filter_image
    # 传入一个很小的字节流但声称尺寸大
    small_bytes = b'\x00' * 100
    assert _filter_image(small_bytes, 200, 200) is False


# ==============================================================================
# _resize_image_bytes 测试
# ==============================================================================

def test_resize_noop():
    """800×600 图片（< 1024）应原样返回。"""
    from extractors import _resize_image_bytes
    png = _make_png(800, 600)
    result = _resize_image_bytes(png, max_px=1024)
    assert result == png  # 未缩放，原样返回


def test_resize_shrinks():
    """2000×1500 图片应缩放至长边 = 1024。"""
    from extractors import _resize_image_bytes
    png = _make_png(2000, 1500)
    result = _resize_image_bytes(png, max_px=1024)
    # 验证缩放后的尺寸
    img = Image.open(io.BytesIO(result))
    w, h = img.size
    assert max(w, h) == 1024
    assert w == 1024  # 长边是宽


def test_resize_maintains_aspect():
    """缩放后宽高比应保持不变（允许 ±1 像素舍入误差）。"""
    from extractors import _resize_image_bytes
    png = _make_png(3000, 2000)
    result = _resize_image_bytes(png, max_px=1024)
    img = Image.open(io.BytesIO(result))
    w, h = img.size
    original_ratio = 3000 / 2000
    new_ratio = w / h
    assert abs(original_ratio - new_ratio) < 0.02  # 允许微小误差


def test_resize_tall_image():
    """高度 > 宽度的图片，高度应缩放到 1024。"""
    from extractors import _resize_image_bytes
    png = _make_png(600, 2000)
    result = _resize_image_bytes(png, max_px=1024)
    img = Image.open(io.BytesIO(result))
    w, h = img.size
    assert h == 1024  # 长边是高度
    assert w < 1024


# ==============================================================================
# _to_png_bytes 测试
# ==============================================================================

def test_to_png_from_jpeg():
    """JPEG 字节应成功转为 PNG。"""
    from extractors import _to_png_bytes
    jpeg = _make_jpeg(400, 300)
    png_bytes, w, h = _to_png_bytes(jpeg, "jpg")
    assert w == 400
    assert h == 300
    # 验证是有效 PNG
    img = Image.open(io.BytesIO(png_bytes))
    assert img.format == "PNG"


def test_to_png_from_png():
    """PNG 字节也应能正常处理。"""
    from extractors import _to_png_bytes
    png = _make_png(200, 150)
    result_bytes, w, h = _to_png_bytes(png, "png")
    assert w == 200
    assert h == 150


# ==============================================================================
# _parse_vlm_response 测试
# ==============================================================================

def test_parse_response_normal():
    """标准格式应正确解析。"""
    from extractors import _parse_vlm_response
    raw = "类型：照片\n描述：一张工厂车间的照片，展示了生产设备和工人。"
    result = _parse_vlm_response(raw)
    assert result["type"] == "照片"
    assert "工厂车间" in result["description"]


def test_parse_response_colon_variants():
    """英文冒号也应能解析。"""
    from extractors import _parse_vlm_response
    raw = "类型:流程图\n描述:一张质量管理流程图。"
    result = _parse_vlm_response(raw)
    assert result["type"] == "流程图"
    assert "质量管理" in result["description"]


def test_parse_response_messy():
    """完全非标准格式应回退到 type='其他' + 原文截断。"""
    from extractors import _parse_vlm_response
    raw = "这是一张很复杂的图片，我无法按照格式输出。"
    result = _parse_vlm_response(raw)
    assert result["type"] == "其他"
    assert len(result["description"]) <= 100
    assert "复杂" in result["description"]


def test_parse_response_fuzzy_type():
    """'数据图表类' 应模糊匹配到 '数据图表'。"""
    from extractors import _parse_vlm_response
    raw = "类型：数据图表类\n描述：一张柱状图。"
    result = _parse_vlm_response(raw)
    assert result["type"] == "数据图表"


def test_parse_response_empty():
    """空字符串应返回 type='其他'、description=''。"""
    from extractors import _parse_vlm_response
    result = _parse_vlm_response("")
    assert result["type"] == "其他"
    assert result["description"] == ""


def test_parse_response_only_type():
    """只有类型行，无描述行。"""
    from extractors import _parse_vlm_response
    raw = "类型：证书"
    result = _parse_vlm_response(raw)
    assert result["type"] == "证书"
    # description 回退到原文
    assert result["description"] != ""


# ==============================================================================
# configure_vlm_context 测试
# ==============================================================================


def test_configure_vlm_context():
    """configure_vlm_context 应正确设置 _vlm_context。"""
    import extractors
    from extractors import configure_vlm_context
    test_ctx = {"A1": "LOGO", "A2": "照片"}
    configure_vlm_context(test_ctx)
    assert extractors._vlm_context == test_ctx


def test_configure_vlm_context_empty():
    """传入 None 应设为空字典。"""
    import extractors
    from extractors import configure_vlm_context
    configure_vlm_context(None)
    assert extractors._vlm_context == {}


# ==============================================================================
# _assemble_image_section_text 测试（mock OCR）
# ==============================================================================

def test_assemble_photo():
    """照片类型应使用 VLM 描述，不触发 OCR。"""
    from extractors import _assemble_image_section_text
    vlm_result = {"type": "照片", "description": "一张厂区照片"}
    text = _assemble_image_section_text(
        vlm_result=vlm_result,
        filename="test.pdf",
        page="3",
        idx=1,
        png_bytes=None,  # 不传 png_bytes，不会触发 OCR
    )
    assert "[图片]" in text
    assert "照片" in text
    assert "一张厂区照片" in text


def test_assemble_flowchart():
    """流程图类型应使用 VLM 描述。"""
    from extractors import _assemble_image_section_text
    vlm_result = {"type": "流程图", "description": "质量管理流程图"}
    text = _assemble_image_section_text(
        vlm_result=vlm_result,
        filename="manual.pdf",
        page="5",
        idx=2,
        png_bytes=None,
    )
    assert "流程图" in text
    assert "质量管理" in text


# ==============================================================================
# 入口
# ==============================================================================

def run_all_tests():
    """按顺序执行所有测试函数。"""
    import inspect
    test_funcs = [
        obj for name, obj in globals().items()
        if name.startswith("test_") and inspect.isfunction(obj)
    ]
    passed = 0
    failed = 0
    for func in test_funcs:
        try:
            func()
            print(f"  ✓ {func.__name__}")
            passed += 1
        except Exception as e:
            print(f"  ✗ {func.__name__}: {e}")
            failed += 1
    print(f"\n  结果：{passed} 通过 / {failed} 失败")
    return failed == 0


if __name__ == "__main__":
    print("=" * 60)
    print("  VLM 基础设施单元测试")
    print("=" * 60)
    success = run_all_tests()
    sys.exit(0 if success else 1)
