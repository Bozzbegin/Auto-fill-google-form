import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

import https from "node:https";
import CacheableLookup from "cacheable-lookup";
import got, { OptionsOfTextResponseBody } from "got";

import puppeteer, { Browser } from "puppeteer";

export const runtime = "nodejs";

type Field = {
  name: string;
  type: string;
  label: string;
  required?: boolean;
  options?: { value: string; label: string }[];
};

const s = (v: unknown) =>
  typeof v === "string" ? v : v == null ? "" : String(v);
const t = (v: unknown) => s(v).trim();

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const dnsCache = new CacheableLookup();

const GOT_BASE: OptionsOfTextResponseBody = {
  timeout: { request: 15000 },
  headers: { "user-agent": "Mozilla/5.0" },
  http2: true,
  agent: { https: httpsAgent },
  dnsCache,
};

dnsCache.lookup("docs.google.com", { family: 4 }, () => {});

let BROWSER_PROMISE: Promise<Browser> | null = puppeteer.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--no-zygote",
  ],
});

async function getBrowser(): Promise<Browser> {
  try {
    return await BROWSER_PROMISE!;
  } catch {
    BROWSER_PROMISE = puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-zygote",
      ],
    });
    return await BROWSER_PROMISE;
  }
}

function extractFromDom($: cheerio.CheerioAPI): {
  action: string;
  hiddenParams: Record<string, string>;
  fields: Field[];
} {
  let $form = $('form[action*="formResponse"]');

  if ($form.length === 0 && $("form").length > 0) {
    $form = $("form");
  }

  const action = s($form.attr("action"));

  const hiddenParams: Record<string, string> = {};
  $form.find('input[type="hidden"]').each((_, el) => {
    const name = s($(el).attr("name"));
    if (!name) return;
    hiddenParams[name] = s($(el).attr("value"));
  });

  const fields: Field[] = [];
  $form.find('[name^="entry."]').each((_, el) => {
    const name = s($(el).attr("name"));
    if (!name || name.endsWith("_sentinel")) return;

    const typeAttr = s($(el).attr("type"));
    const type =
      typeAttr ||
      ($(el).is("textarea")
        ? "textarea"
        : $(el).is("select")
        ? "select"
        : "text");

    const required =
      $(el).attr("aria-required") === "true" ||
      ($(el).prop("required") as any) === true;

    const label =
      t(
        $(el)
          .closest("[role='listitem']")
          .find("div[role='heading']")
          .first()
          .text()
      ) ||
      t($(el).closest("div").find("label").first().text()) ||
      s($(el).attr("aria-label")) ||
      name;

    if ($(el).is("select")) {
      const opts: { value: string; label: string }[] = [];
      $(el)
        .find("option")
        .each((_, op) => {
          opts.push({ value: s($(op).attr("value")), label: t($(op).text()) });
        });
      fields.push({ name, type: "select", label, required, options: opts });
    } else {
      fields.push({ name, type, label, required });
    }
  });

  $form.find('input[name^="entry."][name$="_sentinel"]').each((_, el) => {
    const sentinelName = s($(el).attr("name"));
    const base = sentinelName.replace(/_sentinel$/, "");
    const $item = $(el).closest("[role='listitem']");
    const qLabel =
      t($item.find("div[role='heading']").first().text()) || sentinelName;

    const req =
      $item.find('[role="radiogroup"]').attr("aria-required") === "true";
    const opts: { value: string; label: string }[] = [];
    $item.find('div[role="radio"]').each((__, r) => {
      const lab = t($(r).attr("aria-label")) || t($(r).text());
      if (lab) opts.push({ value: lab, label: lab });
    });

    if (opts.length) {
      const idx = fields.findIndex((f) => f.name === base);
      if (idx >= 0)
        fields[idx] = {
          ...fields[idx],
          type: "radio",
          options: opts,
          required: req,
        };
      else
        fields.push({
          name: base,
          type: "radio",
          label: qLabel,
          required: req,
          options: opts,
        });
    }
  });

  return { action, hiddenParams, fields };
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    if (!url)
      return NextResponse.json({ error: "Missing ?url" }, { status: 400 });

    const html = await got(url, GOT_BASE).text();
    let $ = cheerio.load(html);

    let extracted = extractFromDom($);
    let action: string = extracted.action;
    let hiddenParams: Record<string, string> = extracted.hiddenParams;
    let fields: Field[] = extracted.fields;

    const needPuppeteer =
      !action ||
      fields.length < 3 ||
      !fields.some((f) => /(id|เลขประจำตัว)/i.test(f.label || "")) ||
      !fields.some((f) =>
        /(ชื่อ[-\s]?นามสกุล|full\s*name)/i.test(f.label || "")
      ) ||
      !fields.some((f) => /(ชื่อเล่น|nickname)/i.test(f.label || ""));

    if (needPuppeteer) {
      const browser = await getBrowser();
      const page = await browser.newPage();

      await page.setRequestInterception(true);
      page.on("request", (req2) => {
        const rt = req2.resourceType();
        if (
          rt === "image" ||
          rt === "font" ||
          rt === "media" ||
          rt === "stylesheet"
        ) {
          return req2.abort();
        }
        req2.continue();
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      await page
        .waitForSelector('form[action*="formResponse"]', { timeout: 10000 })
        .catch(() => {});
      await page
        .waitForSelector('[name^="entry."]', { timeout: 5000 })
        .catch(() => {});

      let formHtml = await page
        .$eval('form[action*="formResponse"]', (el) => el.outerHTML)
        .catch(() => "");
      await page.close();

      if (formHtml) {
        const wrapped = `<html><body>${formHtml}</body></html>`;
        $ = cheerio.load(wrapped);
        extracted = extractFromDom($);
        action = extracted.action || action;
        hiddenParams = Object.keys(extracted.hiddenParams).length
          ? extracted.hiddenParams
          : hiddenParams;
        fields = extracted.fields.length ? extracted.fields : fields;
      }
    }

    const fbzx = hiddenParams["fbzx"] || "";
    const payload = { action, fbzx, fields, hiddenParams, originViewUrl: url };

    const res = NextResponse.json(payload);
    res.headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
