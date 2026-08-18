#!/usr/bin/env python3
"""
kol_collector.py — 飞书稿件审核辅助脚本（CDP 自检 + 云文档配图抓取）

ma-draft-review 读取飞书云文档 / wiki / 网页链接稿件时使用（全部走标准脚本，免逐次确认）：

1. --check            检查 CDP 是否开启 + 飞书网页版登录态是否正常
2. --extract-images   打开稿件链接，细粒度滚动触发懒加载，提取全部配图并下载到本地

用法：
    python3 scripts/kol_collector.py --check --port 9222
    python3 scripts/kol_collector.py --extract-images --port 9222 --url "<飞书链接>" --out "<输出目录>"
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

FEISHU_WEB_URL = "https://www.feishu.cn/"

# 页面上下文提取图片的 JS：收集 img/source 的 currentSrc / src / srcset / 懒加载属性，跳过 data: URL 并去重；
# 另兜底提取宫格/画廊布局的 CSS background-image（容器内无 img 时，用容器尺寸近似宽高）
EXTRACT_IMAGES_JS = r"""
(() => {
  const candidatesOf = (el) => {
    const urls = [];
    if (el.currentSrc) urls.push(el.currentSrc);
    if (el.src && el.src !== el.currentSrc) urls.push(el.src);
    for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'data-url']) {
      const value = el.getAttribute(attr);
      if (value) urls.push(value);
    }
    if (el.srcset) urls.push(...el.srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean));
    return urls;
  };
  const bgUrlsOf = (el) => {
    const urls = [];
    const sources = [
      el.getAttribute('style') || '',
      el.currentStyle ? el.currentStyle.backgroundImage : '',
      (() => { try { return getComputedStyle(el).backgroundImage; } catch (e) { return ''; } })(),
    ];
    const re = /url\((['"]?)([^'")]+)\1\)/g;
    for (const src of sources) {
      if (!src) continue;
      let m;
      while ((m = re.exec(src)) !== null) urls.push(m[2]);
    }
    return urls;
  };
  const seen = new Set();
  const out = [];
  for (const el of document.querySelectorAll('img, source')) {
    for (const url of candidatesOf(el)) {
      if (!url || url.startsWith('data:') || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, alt: (el && el.alt) || '', naturalWidth: el.naturalWidth || 0, naturalHeight: el.naturalHeight || 0 });
    }
  }
  // 宫格/画廊兜底：无 img 子元素的容器背景图（img 已收集过的容器跳过，避免重复装饰背景）
  for (const el of document.querySelectorAll('div, section, a, li, span')) {
    if (el.querySelector('img, source')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) continue;
    for (const url of bgUrlsOf(el)) {
      if (!url || url.startsWith('data:') || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, alt: '', naturalWidth: Math.round(rect.width) || 0, naturalHeight: Math.round(rect.height) || 0 });
    }
  }
  return out;
})()
"""

# 页面上下文下载的 JS：复用页面登录态 Cookie 拉取图片字节（redirect 跟随），返回 base64 + content-type
FETCH_B64_JS = r"""
(async () => {
  const res = await fetch(%s, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return { b64: btoa(binary), ct: res.headers.get('content-type') || '' };
})()
"""

# MIME → 扩展名映射（下载文件命名用）
MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/bmp": "bmp",
}


def check_cdp(port: int) -> bool:
    """检查 CDP 端口是否开启"""
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/json/version", timeout=3
        ) as resp:
            info = json.loads(resp.read().decode("utf-8"))
            print(f"[OK] CDP 已开启: {info.get('Browser', 'Chrome')}")
            return True
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] CDP 未开启（{exc}）")
        print("请按以下任一方式启动带调试端口的 Chrome，并登录 https://www.feishu.cn/：")
        print("  A（推荐，隔离配置）：")
        print("    /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\")
        print(f"      --remote-debugging-port={port} --user-data-dir=/tmp/chrome_pgy_debug")
        print("  B（复用已登录的主 Chrome）：先退出所有 Chrome，再执行同样的命令（不带 --user-data-dir）。")
        return False


def _playwright(port: int):
    """惰性导入 playwright 并连接 CDP（返回 p / browser）"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[FAIL] 未安装 playwright Python 包，请运行: pip install playwright")
        sys.exit(1)
    p = sync_playwright().start()
    try:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
    except Exception as exc:  # noqa: BLE001
        p.stop()
        print(f"[FAIL] 连接 CDP 失败: {exc}")
        sys.exit(1)
    if not browser.contexts:
        p.stop()
        print("[FAIL] CDP 无可用浏览器上下文")
        sys.exit(1)
    return p, browser


def check_feishu_login(port: int) -> bool:
    """通过 CDP 打开飞书网页版，判断登录态是否正常"""
    p, browser = _playwright(port)
    try:
        # 在用户默认上下文新建标签页检查，用完即关（不关闭用户浏览器）
        page = browser.contexts[0].new_page()
        try:
            page.goto(FEISHU_WEB_URL, wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(2500)  # 等待可能的登录跳转
            url = page.url
            if "passport" in url or "/login" in url or "login" in page.title().lower():
                print(
                    f"[FAIL] 飞书登录态异常，请先在 Chrome 中登录 https://www.feishu.cn/（当前跳转: {url}）"
                )
                return False
            print(f"[OK] 飞书登录态正常（{url}）")
            return True
        finally:
            page.close()
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 飞书登录态检查失败: {exc}")
        return False
    finally:
        p.stop()


def _collect_images(page) -> list[dict]:
    """执行页面提取 JS，返回 [{url, alt, naturalWidth, naturalHeight}]"""
    try:
        raw = page.evaluate(EXTRACT_IMAGES_JS)
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] 页面图片提取失败: {exc}")
        return []
    if not isinstance(raw, list):
        return []
    return [
        item
        for item in raw
        if isinstance(item, dict) and isinstance(item.get("url"), str) and item["url"]
    ]


def _download_via_page(page, url: str, out_dir: str, seq: int) -> str | None:
    """页面上下文 fetch 下载单张图片到 out_dir，返回本地文件名；失败返回 None"""
    try:
        result = page.evaluate(FETCH_B64_JS % json.dumps(url))
        b64 = result.get("b64", "")
        ct = result.get("ct", "")
        if not b64:
            print(f"[WARN] 图片下载返回空: {url}")
            return None
        data = base64.b64decode(b64)
        ext = MIME_EXT.get((ct or "").split(";")[0].strip(), "jpg")
        # URL 末段做文件名基底（去 query/hash 与危险字符），防止冲突加序号前缀
        base = os.path.basename(url.split("?")[0].split("#")[0])
        base = "".join(c for c in base if c.isalnum() or c in "._-") or "image"
        if not base.lower().endswith(f".{ext}"):
            base = f"{base}.{ext}"
        filename = f"{seq:03d}_{base}"
        with open(os.path.join(out_dir, filename), "wb") as fh:
            fh.write(data)
        return filename
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] 图片下载失败（{exc}）: {url}")
        return None


def extract_images(port: int, url: str, out_dir: str) -> bool:
    """打开稿件链接，细粒度滚动触发懒加载，提取全部配图并下载到本地"""
    p, browser = _playwright(port)
    page = browser.contexts[0].new_page()
    try:
        print(f"[CDP 抓图] 打开稿件链接: {url}")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(1500)  # 等待首屏渲染

        # 细粒度滚动 + 懒加载提取：逐段滚动 400px 后提取，连续 2 轮无新增视为到底
        seen_urls: set[str] = set()
        empty_rounds = 0
        max_rounds = 60
        for _round in range(max_rounds):
            page.mouse.wheel(0, 400)
            page.wait_for_timeout(500)  # 等待懒加载触发
            found = False
            for item in _collect_images(page):
                u = item["url"]
                if u not in seen_urls:
                    seen_urls.add(u)
                    found = True
            empty_rounds = 0 if found else empty_rounds + 1
            if empty_rounds >= 2:
                break
        # 回滚一次再提取，确认顶部图片（懒加载可能在初始位置未触发）
        page.mouse.wheel(0, -800)
        page.wait_for_timeout(500)
        for item in _collect_images(page):
            seen_urls.add(item["url"])
        page.wait_for_timeout(500)

        # 筛选配图：naturalWidth >= 200 且显著大于页面图标/头像
        images = [item for item in _collect_images(page) if (item["naturalWidth"] or 0) >= 200]
        # 用 seen_urls 兜底补全（部分图片宽高在滚动后仍为 0，只要出现在页面即保留）
        known = {item["url"] for item in images}
        for item in _collect_images(page):
            if item["url"] in seen_urls and item["url"] not in known:
                images.append(item)
                known.add(item["url"])

        if not images:
            print(f"[WARN] 未在页面中提取到配图（页面图片总数: {len(seen_urls)}，均小于 200px 或为图标）")
            print("[CDP 抓图] 图片清单: []")
            return True

        os.makedirs(out_dir, exist_ok=True)
        manifest = []
        for idx, item in enumerate(images, start=1):
            filename = _download_via_page(page, item["url"], out_dir, idx)
            if filename:
                manifest.append(
                    {
                        "url": item["url"],
                        "alt": item.get("alt", ""),
                        "width": item.get("naturalWidth") or 0,
                        "height": item.get("naturalHeight") or 0,
                        "path": os.path.join(out_dir, filename),
                    }
                )
        with open(os.path.join(out_dir, "images.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
        print(f"[OK] 提取配图 {len(manifest)} 张（页面图片总数 {len(seen_urls)}），已保存到 {out_dir}")
        print(f"[CDP 抓图] 图片清单: {os.path.join(out_dir, 'images.json')}")
        return len(manifest) > 0
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] CDP 抓图失败: {exc}")
        return False
    finally:
        page.close()
        p.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="飞书稿件审核辅助脚本（CDP 自检 + 云文档配图抓取）")
    parser.add_argument("--check", action="store_true", help="检查 CDP 与飞书登录态")
    parser.add_argument("--extract-images", action="store_true", help="打开稿件链接，提取全部配图并下载到本地")
    parser.add_argument("--port", type=int, default=9222, help="Chrome CDP 远程调试端口")
    parser.add_argument("--url", help="飞书稿件链接（docx / wiki / 网页）")
    parser.add_argument("--out", help="配图下载输出目录（脚本会在其中写入 images.json 清单）")
    args = parser.parse_args()

    if args.check:
        ok = True
        if not check_cdp(args.port):
            ok = False
        if ok and not check_feishu_login(args.port):
            ok = False
        sys.exit(0 if ok else 1)

    if args.extract_images:
        if not args.url or not args.out:
            print("--extract-images 需要 --url 与 --out 参数", file=sys.stderr)
            sys.exit(1)
        sys.exit(0 if extract_images(args.port, args.url, args.out) else 1)

    print("用法: --check 或 --extract-images（详见脚本头部注释）", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
