import { NextResponse, type NextRequest } from "next/server";

// 与 new-api 后端共享的密钥（MOON_STUDIO_SECRET）。未配置时视为“功能关闭”，放行所有请求，
// 避免误锁死；要启用直接访问拦截，请在 canvas 容器和 new-api 都设置相同的 MOON_STUDIO_SECRET。
const SECRET = process.env.MOON_STUDIO_SECRET || "";
const COOKIE_NAME = "ms_auth";

const encoder = new TextEncoder();

function base64urlEncode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecodeToString(value: string): string {
    let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    return atob(normalized);
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return result === 0;
}

// 校验票据：格式 payloadB64.sigB64，HMAC-SHA256 与 new-api 一致；并检查 exp 未过期
async function verifyTicket(ticket: string): Promise<boolean> {
    if (!ticket || !SECRET) return false;
    const dotIndex = ticket.indexOf(".");
    if (dotIndex < 0) return false;
    const payloadB64 = ticket.slice(0, dotIndex);
    const providedSig = ticket.slice(dotIndex + 1);
    if (!payloadB64 || !providedSig) return false;

    try {
        const key = await crypto.subtle.importKey("raw", encoder.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
        const expectedSig = base64urlEncode(new Uint8Array(signature));
        if (!timingSafeEqual(expectedSig, providedSig)) return false;

        const payload = JSON.parse(base64urlDecodeToString(payloadB64)) as { exp?: number };
        if (!payload.exp || payload.exp * 1000 < Date.now()) return false;
        return true;
    } catch {
        return false;
    }
}

function blockedResponse(): NextResponse {
    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Moon Studio</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#e5e5e5;font-family:system-ui,-apple-system,sans-serif}main{text-align:center;padding:24px}h1{font-size:20px;margin:0 0 12px}p{color:#a3a3a3;margin:0 0 20px}a{color:#8b5cf6;text-decoration:none}</style></head><body><main><h1>请从 Moon API 进入 Moon Studio</h1><p>Moon Studio 需要通过 Moon API 账号访问，请勿直接打开本页面。</p><a href="https://api.moonisapi.com">前往 Moon API →</a></main></body></html>`;
    return new NextResponse(html, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function middleware(request: NextRequest) {
    // 未配置密钥：功能关闭，放行（保持可用性，避免误锁死）
    if (!SECRET) return NextResponse.next();

    const ticketParam = request.nextUrl.searchParams.get("ticket");
    const cookieTicket = request.cookies.get(COOKIE_NAME)?.value;

    // 优先用 URL 上的新票据；否则用 cookie 里已保存的票据
    if (ticketParam && (await verifyTicket(ticketParam))) {
        const response = NextResponse.next();
        // 保存票据到 cookie，供后续内部导航使用（有效期跟随票据的 12 小时）
        response.cookies.set(COOKIE_NAME, ticketParam, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            maxAge: 60 * 60 * 12,
        });
        return response;
    }

    if (cookieTicket && (await verifyTicket(cookieTicket))) {
        return NextResponse.next();
    }

    return blockedResponse();
}

// 只拦截页面与画布自身 API，放行静态资源
export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|css|js|map)).*)"],
};
