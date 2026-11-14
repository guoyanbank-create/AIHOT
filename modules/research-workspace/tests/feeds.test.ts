// RSS/Atom 解析：只读必要字段、处理两种格式和相对地址；不联网。
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFeed } from "../providers/feeds.ts";

test("RSS 2.0：标题、链接、发布时间与相对地址", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example</title>
    <item><title>First &amp; story</title><link>https://example.com/a</link><pubDate>Fri, 14 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Second</title><link>/b</link><pubDate>not-a-date</pubDate></item>
    <item><title>Dup</title><link>https://example.com/a</link></item>
  </channel></rss>`;
  const items = parseFeed(xml, "https://example.com/feed.xml", 5);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.title, "First & story");
  assert.equal(items[0]!.publishedAt, "2026-11-14T10:00:00.000Z");
  assert.equal(items[1]!.url, "https://example.com/b");
  assert.equal(items[1]!.publishedAt, null);
});

test("Atom：alternate 链接与 updated 时间", () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Atom one</title><link rel="alternate" href="https://example.com/a1"/><updated>2026-11-14T08:00:00Z</updated></entry>
    <entry><title>Atom two</title><link href="https://example.com/a2"/><published>2026-11-13T08:00:00Z</published></entry>
  </feed>`;
  const items = parseFeed(xml, "https://example.com/atom.xml", 5);
  assert.deepEqual(items.map((item) => item.title), ["Atom one", "Atom two"]);
  assert.equal(items[0]!.url, "https://example.com/a1");
  assert.equal(items[1]!.publishedAt, "2026-11-13T08:00:00.000Z");
});

test("坏 XML 或非 http(s) 链接被安全忽略；limit 生效", () => {
  assert.deepEqual(parseFeed("not xml", "https://example.com", 3), []);
  const xml = `<rss><channel><item><title>FTP</title><link>ftp://example.com/x</link></item>
    <item><title>One</title><link>https://example.com/1</link></item>
    <item><title>Two</title><link>https://example.com/2</link></item>
  </channel></rss>`;
  const items = parseFeed(xml, "https://example.com/feed", 2);
  assert.deepEqual(items.map((item) => item.title), ["One", "Two"]);
});
