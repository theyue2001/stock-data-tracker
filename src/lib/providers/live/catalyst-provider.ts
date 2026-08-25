import { fetchJsonOptional } from "@/lib/providers/live/http";
import { decodeHtmlEntities, rocCompactToDate } from "@/lib/providers/live/parse";
import type { NewsCatalystResult, NewsProvider, ProviderSource, StockRef } from "@/lib/providers/types";

/**
 * Material information filings (重大訊息) from MOPS, as the catalyst feed.
 *
 * These are chosen over a general news API deliberately: a filing is the
 * company speaking on the record, timestamped, attributable, and free of the
 * paraphrase drift that makes scraped headlines a poor audit trail for a
 * research tool. The trade-off is coverage — an analyst upgrade or a supply
 * chain report never appears here — so the catalyst component measures
 * "what the company disclosed", not "what was written about it".
 */

const TWSE_ANNOUNCEMENTS = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L";
const TPEX_ANNOUNCEMENTS = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O";
/**
 * Provenance link stored on every row. MOPS is a hash-routed single-page app,
 * and the server path this used to point at (/mops/web/t05st01) now redirects
 * to /mops/error/error.html, which bounces the reader to the app root — the
 * fragment form below is the only one that actually opens 歷史重大訊息. The
 * legacy host mopsov.twse.com.tw still serves the old path, but TWSE is
 * migrating off it, and the primary host having already switched its
 * /mops/web/* paths off is precisely what broke this link. Nothing fetches
 * this string; it is a display-only provenance value.
 */
const MOPS_URL = "https://mops.twse.com.tw/mops/#/web/t05st01";

interface AnnouncementRow {
  發言日期?: string;
  出表日期?: string;
  事實發生日?: string;
  公司代號?: string;
  SecuritiesCompanyCode?: string;
  公司名稱?: string;
  CompanyName?: string;
  "主旨 "?: string;
  主旨?: string;
  符合條款?: string;
  說明?: string;
}

type Importance = "high" | "medium" | "low";

/**
 * Filing clauses mapped to importance.
 *
 * 符合條款 is the statutory clause the filing was made under, which is a better
 * importance signal than keyword-matching the subject line — but only if the
 * levels reflect the filings that actually arrive under each clause rather than
 * the clause's statutory title. Measured against a full day of the live feed
 * (169 rows), most of the traffic is routine: 第12款 is the single most common
 * clause and every row is a broker-hosted investor conference invite, 第20款 is
 * lease right-of-use assets, structured deposits, equipment orders and
 * portfolio churn (one holding company filed seven in a single day), and
 * 第14款/第36款 are the dividend and capital-registration calendar. Those sit at
 * the bottom because the catalyst score sums a whole industry's filings: at
 * medium weight, two ordinary disclosure days saturate the component. The
 * clause that reliably moves a thesis is 第10款 (drug and R&D approvals); the
 * severe events that arrive under a routine or residual clause are lifted by
 * the keyword pass below instead.
 *
 * Two clauses are deliberately unmapped: 第51款 (TWSE) and 第53款 (TPEx) are the
 * exchanges' residual "其他" clauses and mix 更名/面額 boilerplate with 澄清
 * 報導, court orders and share-swap ratios in one bucket, so no single level
 * fits them. They fall through to the keyword pass, as does any clause number
 * not listed here, so a newly used clause degrades to under-weighting rather
 * than to being dropped.
 */
const CLAUSE_IMPORTANCE: Record<string, Importance> = {
  "第10款": "high", // 新藥/重大研發取得核准
  "第2款": "medium", // 訴訟、非訟或行政爭訟事件 — keywords lift an indictment to high
  "第6款": "medium", // 董事、監察人及經理人變動
  "第11款": "medium", // 增資、減資及其他募資
  "第26款": "medium", // 其他重大影響股東權益 — a catch-all, so never high on the clause alone
  "第31款": "medium", // 財務報告經董事會決議通過
  "第35款": "medium", // 庫藏股買回
  "第8款": "low", // 發言人、內部稽核主管、資訊安全長異動
  "第12款": "low", // 受邀參加法人說明會
  "第14款": "low", // 股利分派、除息基準日
  "第18款": "low", // 股東會決議事項
  "第20款": "low", // 取得或處分資產 — routine asset and treasury churn, see above
  "第36款": "low", // 減資、註銷變更登記完成
};

/**
 * Subject-line escalation applied on top of the clause. It can only raise a
 * filing's level, never lower it: a clause that is mostly routine must not be
 * lifted by its own boilerplate wording, but a drug approval or a breach filed
 * under a residual clause still has to reach the top.
 *
 * 法說會, 投資, 處分 and 合作 were removed from the medium list once the clause
 * levels were corrected. The first would re-lift all 28 daily conference
 * invites that 第12款 just demoted, and the rest fire on names rather than
 * events — 上緯國際投資控股 renaming itself scored medium on the 投資 in its own
 * former name, 處分理財商品 is a rolled deposit, and 合作金庫 is a bank.
 *
 * Distress and litigation wording is matched here rather than by clause: the
 * clause the table used to reserve for 重整/財務困難 never appeared in the feed,
 * so its label was unverifiable, while the wording itself is unambiguous
 * wherever it is filed.
 */
const HIGH_KEYWORDS =
  /擴產|建廠|新產能|重大訂單|合資|收購|併購|漲價|調漲|認證通過|量產|新藥|查驗登記|許可證|獲准|取證|FDA|EMA|厚生勞動省|資安事件|網路安全事件|網路攻擊|個資外洩|起訴|判決|假扣押|重整|破產|財務困難/;
const MEDIUM_KEYWORDS = /營運展望|策略聯盟|策略合作|技術合作|技術授權|合作備忘錄|簽約|簽訂/;

/**
 * MOPS re-files an event as a supplement — 主旨 opens with (補充公告) or
 * (補充說明) — days or months after the original, and some of those bodies
 * state 對公司財務業務之影響：無 outright. Both still earn a row, since the feed
 * is meant to be a complete audit trail, but neither may add fresh catalyst
 * weight on top of the original filing, so they are capped at low.
 */
const SUPPLEMENT_SUBJECT = /^[（(]\s*補充/;
const NO_IMPACT_BODY = /財務業務之影響[:：]無/;

/**
 * The quantity/price/amount field of an asset filing, used as the identity of
 * the transaction it describes.
 *
 * Deliberately NOT an attempt to extract the 交易總金額 on its own. MOPS labels
 * this field as one compound heading —
 * `5.交易單位數量（如ＸＸ平方公尺，折合ＸＸ坪）、每單位價格及交易總金額:` —
 * so 交易總金額 is the TAIL of the label, and the first number after the colon
 * is the quantity, not the total: on a sampled feed 14 of 25 matches captured
 * an area or a share count (2313 captured 17,698, the land area in sq wah, for
 * a THB385,391,370 purchase). The total does appear, but later in the same
 * free-text field and in whatever currency and phrasing the filer chose.
 *
 * Since the only use is matching a 取得 filing to the 處分 filing of the same
 * asset, the whole field's digits are a better identity than any one number
 * pulled out of it — both filings state the same quantity AND the same amount,
 * so the fingerprint agrees whether or not the total can be isolated.
 */
const TRANSACTION_FIELD = /交易總金額[^:：]{0,20}[:：](.{0,400}?)(?=\d{1,2}\.[一-鿿]|$)/;

/**
 * Digits of the transaction field, as a comparison fingerprint.
 *
 * A fingerprint, never a reported figure: it is used only as a Set key here and
 * is neither stored nor displayed. That matters because the field has no
 * delimiter before the next numbered heading, so an amount ending in a digit
 * run into `6.交易相對人` truncates (…385,391,370 fingerprints as 38539137).
 * The truncation is deterministic, so both sides of a 取得/處分 pair produce the
 * same key and still collapse, which is all this is for.
 *
 * Returns null when the field carries no numbers at all, so an empty string can
 * never make two unrelated filings collide.
 */
function transactionFingerprint(normalizedDescription: string): string | null {
  const field = TRANSACTION_FIELD.exec(normalizedDescription)?.[1];
  if (!field) return null;
  const digits = field.match(/\d[\d,]*/g);
  if (!digits) return null;
  return digits.map((d) => d.replace(/,/g, "")).join("|");
}

const RANK: Record<Importance, number> = { low: 0, medium: 1, high: 2 };

export class MopsCatalystProvider implements NewsProvider {
  readonly source: ProviderSource = {
    key: "mops-material-info",
    name: "MOPS Material Information Filings",
    category: "news",
    url: MOPS_URL,
    isMock: false,
    description:
      "Company-filed material information announcements (重大訊息) for listed and OTC companies, used as the catalyst feed.",
  };

  async fetchLatest(stocks: StockRef[]): Promise<NewsCatalystResult[]> {
    const wanted = new Set(stocks.map((s) => s.ticker));

    const [twse, tpex] = await Promise.all([
      fetchJsonOptional<AnnouncementRow[]>(TWSE_ANNOUNCEMENTS),
      fetchJsonOptional<AnnouncementRow[]>(TPEX_ANNOUNCEMENTS),
    ]);

    const out: NewsCatalystResult[] = [];
    const seenTransactions = new Set<string>();
    for (const row of [...(twse ?? []), ...(tpex ?? [])]) {
      const ticker = (row.公司代號 ?? row.SecuritiesCompanyCode ?? "").trim();
      if (!wanted.has(ticker)) continue;

      // The TWSE feed ships this key with a trailing space in the JSON, and
      // escapes rare CJK characters as numeric entities. MOPS also hard-wraps
      // 主旨 at a fixed column, so the value arrives with CRLF mid-sentence —
      // roughly a third of the rows — which lands as a stray space in the UI
      // and as a literal \r\n inside the daily-brief prompt. Collapsing runs of
      // whitespace after decoding also catches an entity that decodes to one.
      const title = decodeHtmlEntities(row["主旨 "] ?? row.主旨 ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!title) continue;

      // 說明 keeps its line breaks: they separate the numbered disclosure
      // fields, so collapsing them would run the fields together.
      const description = decodeHtmlEntities((row.說明 ?? "").trim());

      const spoke = rocCompactToDate(row.發言日期 ?? row.出表日期 ?? "");
      const fact = rocCompactToDate(row.事實發生日 ?? "");
      // MOPS re-emits a rolling 更名/面額 notice on every business day of its
      // three-month 公告期間, with a fresh 發言日期 and a batch 發言時間 of
      // 07:00:03, while 事實發生日 stays pinned to the original event. Dating by
      // the event collapses those ~65 daily re-emissions onto the single row
      // that writeCatalysts already dedupes on (stock, date, title). Only when
      // the event precedes the announcement: the feed also carries future
      // 事實發生日 for scheduled 法說會 and 基準日 dates — 28 of 169 rows on an
      // ordinary day — and those have to keep 發言日期.
      const date = fact && spoke && fact.getTime() < spoke.getTime() ? fact : spoke;
      if (!date) continue;

      // One asset moving between two subsidiaries is filed twice, once as 處分
      // and once as 取得, stating the same quantity and the same amount. That is
      // one event in two rows, and the subject lines differ enough that the
      // (stock, date, title) dedupe downstream keeps both, so collapse them on
      // the transaction's own figures here instead.
      const amount = transactionFingerprint(description.replace(/\s+/g, ""));
      if (amount) {
        const key = `${ticker}|${date.getTime()}|${(row.符合條款 ?? "").trim()}|${amount}`;
        if (seenTransactions.has(key)) continue;
        seenTransactions.add(key);
      }

      out.push({
        ticker,
        title,
        description: description.slice(0, 500) || undefined,
        date,
        importance: classifyImportance(row.符合條款, title, description),
        source: "MOPS 重大訊息",
        sourceUrl: MOPS_URL,
      });
    }
    return out;
  }
}

function classifyImportance(clause: string | undefined, title: string, description: string): Importance {
  // Quoted spans are dropped before the keyword pass: company names live inside
  // 「」 in a MOPS subject line, and matching a keyword against a name scores
  // the name rather than the event.
  const subject = title.replace(/[「『][^」』]*[」』]/g, " ");
  const keyword: Importance | undefined = HIGH_KEYWORDS.test(subject)
    ? "high"
    : MEDIUM_KEYWORDS.test(subject)
      ? "medium"
      : undefined;

  const level = clause ? (CLAUSE_IMPORTANCE[clause.trim()] ?? "low") : "low";
  const escalated = keyword && RANK[keyword] > RANK[level] ? keyword : level;

  if (SUPPLEMENT_SUBJECT.test(title) || NO_IMPACT_BODY.test(description.replace(/\s+/g, ""))) return "low";
  return escalated;
}
