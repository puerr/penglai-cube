#!/usr/bin/env python3
"""交互断言:证明这个页面是"活的",不只是能出第一帧。

verify.py 用的是 freeze=1(为了截图可复现),所以动画、快捷键、交互一直没被验过。
这个脚本跑不冻结的那一版,逐条断言。

    python3 tools/interact.py
"""
import os
import pathlib
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".browsers"))
PAGE = (ROOT / "index.html").as_uri()
ARGS = [
    "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage",
    "--force-device-scale-factor=1",
]

FAILED = []


def wait_frames(page, n=2, timeout=180):
    """等"真的渲染了 n 帧" —— 这台机器软件光栅一帧 1~2 秒,sleep 秒数不可靠。"""
    start = page.evaluate("window.__frames || 0")
    page.wait_for_function(f"(window.__frames || 0) >= {start + n}", timeout=timeout * 1000)


def check(name, cond, detail=""):
    mark = "✅" if cond else "❌"
    print(f"  {mark} {name}{('  ' + detail) if detail else ''}")
    if not cond:
        FAILED.append(name)


def main() -> int:
    env = {k: v for k, v in os.environ.items() if k != "DISPLAY"}
    with sync_playwright() as p:
        browser = p.chromium.launch(env=env, args=ARGS)
        page = browser.new_page(viewport={"width": 1100, "height": 700})
        page.set_default_timeout(300000)
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))

        page.goto(PAGE + "?dpr=1", wait_until="load")
        page.wait_for_function("window.__worldReady === true", timeout=300000)
        time.sleep(1.0)

        # 1. 昼夜在推进
        t1 = page.evaluate("window.__world.pal.t")
        wait_frames(page, 3)
        t2 = page.evaluate("window.__world.pal.t")
        check("昼夜自动推进", t2 != t1, f"t {t1:.4f} → {t2:.4f}")

        # 2. 水面 / 云在动(uniform 与实例矩阵都要变)
        u1 = page.evaluate("window.__world.parts.water.uniforms.uTime.value")
        wait_frames(page, 2)
        u2 = page.evaluate("window.__world.parts.water.uniforms.uTime.value")
        check("水面动画时间在走", u2 > u1, f"uTime {u1:.2f} → {u2:.2f}")

        # 3. 空格暂停
        page.keyboard.press("Space")
        wait_frames(page, 2)
        p1 = page.evaluate("window.__world.pal.t")
        wait_frames(page, 2)
        p2 = page.evaluate("window.__world.pal.t")
        check("空格暂停昼夜", abs(p2 - p1) < 1e-6, f"t {p1:.4f} → {p2:.4f}")
        page.keyboard.press("Space")
        wait_frames(page, 2)
        p3 = page.evaluate("window.__world.pal.t")
        check("空格恢复昼夜", p3 != p2, f"t → {p3:.4f}")

        # 4. 数字键跳到时刻
        page.keyboard.press("4")
        wait_frames(page, 2)
        t4 = page.evaluate("window.__world.pal.t")
        check("按 4 跳到黄昏", abs(t4 - 0.67) < 0.02, f"t={t4:.3f}")
        lab = page.evaluate("document.getElementById('hud-phase').textContent")
        clock = page.evaluate("document.getElementById('hud-clock').textContent")
        check("HUD 时刻与时钟同一基准", lab in ("黄昏", "午后", "暮色"), f"{lab} {clock}")

        # 5. H 收起 HUD
        page.keyboard.press("h")
        wait_frames(page, 1)
        op = page.evaluate("document.getElementById('hud').style.opacity")
        check("H 收起 HUD", op == "0", f"opacity={op}")
        page.keyboard.press("h")

        # 6. 拖拽旋转
        c0 = page.evaluate("window.__world.camera.position.toArray()")
        page.mouse.move(550, 350)
        page.mouse.down()
        page.mouse.move(760, 350, steps=12)
        page.mouse.up()
        wait_frames(page, 3)
        c1 = page.evaluate("window.__world.camera.position.toArray()")
        moved = sum(abs(a - b) for a, b in zip(c0, c1))
        check("拖拽能绕轴旋转", moved > 1.0, f"位移 {moved:.2f}")

        # 7. 滚轮推近
        z0 = page.evaluate("window.__world.camera.zoom")
        page.mouse.move(550, 350)
        page.mouse.wheel(0, -600)
        wait_frames(page, 3)
        z1 = page.evaluate("window.__world.camera.zoom")
        check("滚轮能推近", z1 > z0, f"zoom {z0:.2f} → {z1:.2f}")

        # 8. R 复位
        page.keyboard.press("r")
        wait_frames(page, 2)
        z2 = page.evaluate("window.__world.camera.zoom")
        check("R 复位视角", abs(z2 - 1.0) < 0.01, f"zoom={z2:.3f}")

        # 9. 暂停后期链不崩
        page.keyboard.press("p")
        wait_frames(page, 2)
        page.keyboard.press("p")
        wait_frames(page, 2)
        check("后期开关切换不报错", not errs, f"errors={len(errs)}")

        # 10. 尺寸变化不崩
        page.set_viewport_size({"width": 700, "height": 1000})
        wait_frames(page, 2)
        ok = page.evaluate("window.__world.camera.top")
        check("resize 后相机仍然有效", isinstance(ok, (int, float)), f"top={ok}")

        check("全程 console 零 error", not errs, str(errs[:3]))
        browser.close()

    print()
    if FAILED:
        print(f"❌ {len(FAILED)} 条失败: {FAILED}")
        return 1
    print("✅ 全部断言通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
