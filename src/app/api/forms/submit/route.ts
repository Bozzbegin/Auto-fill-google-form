import { NextRequest, NextResponse } from "next/server";
import https from "node:https";
import CacheableLookup from "cacheable-lookup";
import got from "got";

const s = (v: unknown) =>
  typeof v === "string" ? v : v == null ? "" : String(v);

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const dnsCache = new CacheableLookup();
dnsCache.lookup("docs.google.com", { family: 4 }, () => {});

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: string;
      fbzx?: string;
      answers?: Record<string, unknown>;
      hiddenParams?: Record<string, unknown>;
      originViewUrl?: string;
    };

    const { action, fbzx, originViewUrl } = body;
    const answers = (body.answers ?? {}) as Record<string, unknown>;
    const hiddenParams = (body.hiddenParams ?? {}) as Record<string, unknown>;

    if (!action || !answers) {
      return NextResponse.json(
        { error: "Missing action or answers" },
        { status: 400 }
      );
    }

    const form = new URLSearchParams();

    Object.entries(answers).forEach(([k, v]) => {
      if (Array.isArray(v))
        (v as unknown[]).forEach((val) => form.append(k, s(val)));
      else form.append(k, s(v));
    });

    Object.keys(answers).forEach((k) => {
      if (/^entry\.\d+$/.test(k)) {
        const sentKey = `${k}_sentinel`;
        if (!form.has(sentKey)) form.append(sentKey, "");
      }
    });

    Object.entries(hiddenParams).forEach(([k, v]) => {
      if (!form.has(k)) form.append(k, s(v));
    });

    if (fbzx && !form.has("fbzx")) form.append("fbzx", s(fbzx));
    if (!form.has("fvv")) form.append("fvv", "1");
    if (!form.has("pageHistory")) form.append("pageHistory", "0");
    if (!form.has("submissionTimestamp"))
      form.append("submissionTimestamp", "-1");

    const resp = await got.post(action, {
      body: form.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "Mozilla/5.0",
        origin: "https://docs.google.com",
        referer: originViewUrl || action.replace("/formResponse", "/viewform"),
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      throwHttpErrors: false,
      timeout: { request: 20000 },
      http2: true,
      agent: { https: httpsAgent },
      dnsCache,
    });

    const ok =
      resp.statusCode === 200 && !/error|bad request/i.test(resp.body || "");
    return NextResponse.json({
      success: ok,
      status: resp.statusCode,
      debug: ok ? undefined : resp.body?.slice(0, 1200),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
