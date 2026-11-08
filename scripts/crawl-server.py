"""crawl4ai の最小 HTTP ラッパ: POST /md {"url"} -> {"markdown"} (D-017)

公式 Docker サーバと同じ /md の形にしてあるので、後で Docker に移しても
Studio 側のクライアントは変えなくてよい。

起動: uv run --with fastapi --with uvicorn scripts/crawl-server.py
localStorage 前提: 127.0.0.1 のみに束縛し、認証は置かない。
"""

import ipaddress
import re
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import uvicorn
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
from crawl4ai.content_filter_strategy import PruningContentFilterLXML
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MAX_MARKDOWN = 8000  # プロンプトを膨らませない（P21 完了条件）
# 素の Markdown は先頭がナビで埋まり、天気などの本文が 8000 文字に収まらない。
# ナビを削った fit_markdown を返す（tenki.jp/weathernews で実測）
MARKDOWN_GENERATOR = DefaultMarkdownGenerator(content_filter=PruningContentFilterLXML())
PRIVATE = re.compile(
    r"^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)", re.I
)

crawler: AsyncWebCrawler | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global crawler
    crawler = AsyncWebCrawler()
    await crawler.start()
    yield
    await crawler.close()


app = FastAPI(lifespan=lifespan)


class FetchRequest(BaseModel):
    url: str


@app.post("/md")
async def md(req: FetchRequest) -> dict[str, str]:
    parsed = urlparse(req.url)
    if parsed.scheme not in ("http", "https") or PRIVATE.match(parsed.hostname or ""):
        raise HTTPException(400, "url not allowed")
    try:
        ipaddress.ip_address(parsed.hostname or "")
        raise HTTPException(400, "url not allowed")
    except ValueError:
        pass

    result = await crawler.arun(
        url=req.url, config=CrawlerRunConfig(markdown_generator=MARKDOWN_GENERATOR)
    )
    if not result.success:
        raise HTTPException(502, "fetch failed")
    markdown = getattr(result.markdown, "fit_markdown", None) or str(result.markdown)
    return {"markdown": markdown[:MAX_MARKDOWN]}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=11235)
