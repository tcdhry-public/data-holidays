// 祝日の元データを取得して、ローカルのファイルに保存する。
//   node scripts/fetch.mjs [出力先]   出力先の既定は _gitignore/fetched
// 保存するもの:
//   cao.csv          内閣府の CSV(取得したまま。Shift_JIS)
//   cao.utf8.csv     同じものを UTF-8 に変換したもの(確認用)
//   google.ics       Google カレンダーの日本の祝日(祝日だけのカレンダー。取得したまま。UTF-8)
//   fetch-log.json   取得の記録(URL、HTTP ステータス、大きさ、SHA-256、Last-Modified、ETag)
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCES = [
  {
    id: "cao",
    url: "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv",
    file: "cao.csv",
    encoding: "shift_jis",
    utf8File: "cao.utf8.csv",
  },
  {
    id: "google",
    // 祝日だけのカレンダー(ID に .official が付くもの)。行事(節分など)は含まない
    url: "https://calendar.google.com/calendar/ical/ja.japanese.official%23holiday%40group.v.calendar.google.com/public/basic.ics",
    file: "google.ics",
  },
];

const USER_AGENT = "data-holidays/0.1 (+https://github.com/tcdhry-public/data-holidays)";

async function fetchSource(source, outDir) {
  const res = await fetch(source.url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`${source.id}: HTTP ${res.status} ${res.statusText}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeFile(join(outDir, source.file), bytes);
  if (source.utf8File) {
    // fatal: true で、変換できないバイトがあれば止める(文字化けしたまま保存しない)
    const text = new TextDecoder(source.encoding, { fatal: true }).decode(bytes);
    await writeFile(join(outDir, source.utf8File), text, "utf8");
  }
  return {
    id: source.id,
    url: source.url,
    status: res.status,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    lastModified: res.headers.get("last-modified"),
    etag: res.headers.get("etag"),
  };
}

async function main() {
  const outDir = process.argv[2] ?? join("_gitignore", "fetched");
  await mkdir(outDir, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const results = [];
  for (const source of SOURCES) {
    const result = await fetchSource(source, outDir);
    results.push(result);
    console.log(`${result.id}: ${result.status} ${result.bytes} bytes -> ${join(outDir, source.file)}`);
  }
  await writeFile(join(outDir, "fetch-log.json"), JSON.stringify({ fetchedAt, results }, null, 2) + "\n", "utf8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
