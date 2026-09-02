# -*- coding: utf-8 -*-
"""生成微信小程序 tabBar 图标（81x81 PNG）。"""
import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(
    os.path.dirname(__file__),
    "src", "static", "tabbar",
)
os.makedirs(OUT_DIR, exist_ok=True)

SIZE = 81
SCALE = 6
W = SIZE * SCALE
CENTER = W / 2

GREY = (154, 160, 166, 255)
ORANGE = (249, 115, 22, 255)


def new_canvas():
    return Image.new("RGBA", (W, W), (0, 0, 0, 0))


def stroke_width():
    return int(W * 0.075)


def draw_home(color):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    lw = stroke_width()
    # 屋顶
    d.line([(W*0.18, W*0.50), (W*0.5, W*0.24), (W*0.82, W*0.50)],
           fill=color, width=lw, joint="curve")
    # 主体
    d.rounded_rectangle(
        [(W*0.28, W*0.46), (W*0.72, W*0.82)],
        radius=W*0.05, outline=color, width=lw)
    # 门
    d.rounded_rectangle(
        [(W*0.42, W*0.60), (W*0.58, W*0.82)],
        radius=W*0.03, outline=color, width=int(lw*0.9))
    return img


def draw_check(color):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    lw = stroke_width()
    d.ellipse([W*0.14, W*0.14, W*0.86, W*0.86],
              outline=color, width=lw)
    # 对勾
    d.line([(W*0.30, W*0.52), (W*0.45, W*0.66), (W*0.70, W*0.38)],
           fill=color, width=int(lw*1.05), joint="curve")
    return img


def draw_calendar(color):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    lw = stroke_width()
    d.rounded_rectangle(
        [(W*0.16, W*0.26), (W*0.84, W*0.84)],
        radius=W*0.07, outline=color, width=lw)
    # 顶部横线
    d.line([(W*0.16, W*0.40), (W*0.84, W*0.40)],
           fill=color, width=int(lw*0.9))
    # 两个挂环
    d.line([(W*0.30, W*0.26), (W*0.30, W*0.40)], fill=color, width=lw)
    d.line([(W*0.70, W*0.26), (W*0.70, W*0.40)], fill=color, width=lw)
    # 日期点
    for x in (0.34, 0.50, 0.66):
        d.line([(W*x, W*0.55), (W*x, W*0.66)], fill=color, width=int(lw*0.8))
    return img


def draw_wallet(color):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    lw = stroke_width()
    d.rounded_rectangle(
        [(W*0.14, W*0.28), (W*0.86, W*0.80)],
        radius=W*0.07, outline=color, width=lw)
    # 卡扣
    d.rounded_rectangle(
        [(W*0.30, W*0.28), (W*0.62, W*0.44)],
        radius=W*0.04, outline=color, width=int(lw*0.9))
    # 符号 ¥
    d.line([(W*0.50, W*0.50), (W*0.50, W*0.72)], fill=color, width=lw)
    d.line([(W*0.38, W*0.56), (W*0.50, W*0.50), (W*0.62, W*0.56)],
           fill=color, width=int(lw*0.9))
    d.line([(W*0.38, W*0.68), (W*0.50, W*0.62), (W*0.62, W*0.68)],
           fill=color, width=int(lw*0.9))
    return img


def draw_user(color):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    lw = stroke_width()
    # 头
    d.ellipse([W*0.34, W*0.18, W*0.66, W*0.50],
              outline=color, width=lw)
    # 肩
    d.arc([W*0.14, W*0.52, W*0.86, W*1.06],
          start=195, end=345, fill=color, width=lw)
    return img


def save(img, name, color):
    down = img.resize((SIZE, SIZE), Image.LANCZOS)
    down.save(os.path.join(OUT_DIR, f"{name}-{color}.png"))


for color, label in [(GREY, "gray"), (ORANGE, "active")]:
    save(draw_home(color), "home", label)
    save(draw_check(color), "checkin", label)
    save(draw_calendar(color), "plan", label)
    save(draw_wallet(color), "ledger", label)
    save(draw_user(color), "me", label)

print("icons generated:", sorted(os.listdir(OUT_DIR)))
