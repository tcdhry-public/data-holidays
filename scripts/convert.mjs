// 取得した元データを読み取り、値をそのまま JSON に書き出す。両方の同じ日付の情報を 1 つのデータにまとめる。
// 値の正規化(名前の書き換え、日付の書式の統一など)は一切しない。
//   node scripts/convert.mjs [取得データの場所] [確認用の出力先] [公開用の出力先]
//   既定は _gitignore/fetched、_gitignore/converted、data
// 確認用の出力先に書き出すもの(公開しない):
//   cao.json      内閣府の CSV の各行(見出しをキーにした、csv-parse の読み取り結果そのまま)
//   google.json   Google の ics の各 VEVENT(プロパティ名ごとに、ical.js の読み取り結果の値を並べたもの)
// 公開用の出力先に書き出すもの(GitHub Pages で公開する):
//   years/YYYY.json  {"YYYY-MM-DD": "名前"} の形。公開するので最小限にする。
//                 日付は内閣府と Google の両方にあるもの(積集合)だけを残す。名前は Google の SUMMARY をそのまま使う。
//                 1 つの日付に内閣府の行や Google の VEVENT が 2 つ以上あるとき、SUMMARY が 1 つでないときは止める
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import ICAL from "ical.js";

const CAO_DATE_COLUMN = "国民の祝日・休日月日";

function readCao(bytes) {
  // 内閣府の CSV は Shift_JIS。変換できないバイトがあれば止める
  const text = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
  return parse(text, { columns: true, skip_empty_lines: true });
}

function readGoogle(text) {
  const calendar = new ICAL.Component(ICAL.parse(text));
  return calendar.getAllSubcomponents("vevent").map((vevent) => {
    const event = {};
    for (const prop of vevent.getAllProperties()) {
      const values = prop.getValues().map((v) => (typeof v === "string" ? v : v.toString()));
      (event[prop.name] ??= []).push(...values);
    }
    return event;
  });
}

// 日付ごとにまとめるためのキー(YYYY-MM-DD)。キーにだけ使い、各データの値は書き換えない
function caoDateKey(row) {
  const [y, m, d] = row[CAO_DATE_COLUMN].split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function googleDateKey(event) {
  return event.dtstart[0];
}

// 両方にある日付(積集合)だけを残し、{"YYYY-MM-DD": Google の SUMMARY} にする
function merge(caoRows, googleEvents) {
  const cao = Map.groupBy(caoRows, caoDateKey);
  const google = Map.groupBy(googleEvents, googleDateKey);
  const result = {};
  for (const date of [...cao.keys()].filter((d) => google.has(d)).sort()) {
    const rows = cao.get(date);
    const events = google.get(date);
    if (rows.length !== 1) throw new Error(`${date}: 内閣府の行が ${rows.length} 個ある`);
    if (events.length !== 1) throw new Error(`${date}: Google の VEVENT が ${events.length} 個ある`);
    const summary = events[0].summary ?? [];
    if (summary.length !== 1) throw new Error(`${date}: Google の SUMMARY が ${summary.length} 個ある`);
    result[date] = summary[0];
  }
  return result;
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function main() {
  const inDir = process.argv[2] ?? join("_gitignore", "fetched");
  const outDir = process.argv[3] ?? join("_gitignore", "converted");
  const dataDir = process.argv[4] ?? "data";
  await mkdir(outDir, { recursive: true });

  const caoRows = readCao(await readFile(join(inDir, "cao.csv")));
  const googleEvents = readGoogle(await readFile(join(inDir, "google.ics"), "utf8"));
  const merged = merge(caoRows, googleEvents);

  await writeJson(join(outDir, "cao.json"), caoRows);
  await writeJson(join(outDir, "google.json"), googleEvents);
  const byYear = Map.groupBy(Object.entries(merged), ([date]) => date.slice(0, 4));
  await mkdir(join(dataDir, "years"), { recursive: true });
  for (const [year, entries] of byYear) {
    await writeJson(join(dataDir, "years", `${year}.json`), Object.fromEntries(entries));
  }

  console.log(`cao: ${caoRows.length} rows, google: ${googleEvents.length} events -> ${outDir}`);
  console.log(`merged: ${Object.keys(merged).length} dates in ${[...byYear.keys()].join(", ")} -> ${dataDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
