import re
from dataclasses import dataclass
from html import unescape
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from loguru import logger


@dataclass(frozen=True)
class WebSearchResult:
    title: str
    url: str
    snippet: str
    query: str
    provider: str = "DuckDuckGo HTML"


def _clean_duckduckgo_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(target)
    return raw_url


def _clean_yahoo_url(raw_url: str) -> str:
    raw_url = unescape(raw_url)
    parsed = urlparse(raw_url)
    if parsed.netloc.endswith("search.yahoo.com"):
        match = re.search(r"/RU=([^/]+)/", raw_url)
        if match:
            return unquote(match.group(1))
    return raw_url


def _is_supported_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _clean_html(raw_html: str) -> str:
    return unescape(re.sub(r"<[^>]+>", " ", raw_html)).strip()


def _parse_duckduckgo_results(
    html: str,
    query: str,
    limit: int,
) -> list[WebSearchResult]:
    results: list[WebSearchResult] = []
    seen_urls: set[str] = set()

    for block in re.split(r'<div class="result results_links', html):
        link_match = re.search(
            r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
            block,
            flags=re.DOTALL,
        )
        if not link_match:
            continue

        url = _clean_duckduckgo_url(unescape(link_match.group(1)))
        if not _is_supported_url(url) or url in seen_urls:
            continue

        title = _clean_html(link_match.group(2))
        if not title:
            continue

        snippet = ""
        snippet_match = re.search(
            r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
            block,
            flags=re.DOTALL,
        )
        if snippet_match:
            snippet = _clean_html(snippet_match.group(1))

        seen_urls.add(url)
        results.append(
            WebSearchResult(
                title=title,
                url=url,
                snippet=snippet,
                query=query,
                provider="DuckDuckGo HTML",
            )
        )
        if len(results) >= limit:
            break

    return results


def _parse_yahoo_results(
    html: str,
    query: str,
    limit: int,
) -> list[WebSearchResult]:
    results: list[WebSearchResult] = []
    seen_urls: set[str] = set()

    for link_match in re.finditer(
        r'<a[^>]+href="([^"]*r\.search\.yahoo\.com[^"]+)"[^>]*>(.*?)</a>',
        html,
        flags=re.DOTALL,
    ):
        url = _clean_yahoo_url(link_match.group(1))
        if not _is_supported_url(url) or url in seen_urls:
            continue

        parsed_url = urlparse(url)
        if parsed_url.netloc.endswith(("yahoo.com", "bing.com")):
            continue

        title = _clean_html(link_match.group(2))
        if not title or "Yahoo Scout" in title:
            continue

        seen_urls.add(url)
        results.append(
            WebSearchResult(
                title=title,
                url=url,
                snippet="",
                query=query,
                provider="Yahoo Search",
            )
        )
        if len(results) >= limit:
            break

    return results


async def _search_duckduckgo(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
) -> list[WebSearchResult]:
    response = await client.get(
        "https://duckduckgo.com/html/",
        params={"q": query},
    )
    response.raise_for_status()
    return _parse_duckduckgo_results(response.text, query, limit)


async def _search_yahoo(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
) -> list[WebSearchResult]:
    response = await client.get(
        "https://search.yahoo.com/search",
        params={"p": query},
    )
    response.raise_for_status()
    return _parse_yahoo_results(response.text, query, limit)


async def search_web(query: str, limit: int = 5) -> list[WebSearchResult]:
    """Search the open web for learning materials without requiring an API key."""
    if not query.strip():
        return []

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(8.0, connect=4.0),
        follow_redirects=True,
        headers={
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0 Safari/537.36"
            ),
        },
    ) as client:
        for provider, search in (
            ("DuckDuckGo HTML", _search_duckduckgo),
            ("Yahoo Search", _search_yahoo),
        ):
            try:
                results = await search(client, query, limit)
            except Exception as exc:
                logger.warning(
                    f"{provider} failed for query={query!r}: {exc}"
                )
                continue
            if results:
                return results

    return []
