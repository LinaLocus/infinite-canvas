import { NextResponse, type NextRequest } from "next/server";

// Moon API 校验端点：画布把用户的 session cookie 转发给它，判断当前是否登录。
// 通过 env 覆盖以适配不同部署；默认走公开子域。
const VERIFY_URL = process.env.MOON_STUDIO_VERIFY_URL || "https://api.moonisapi.com/api/moon_studio/verify";
// 是否启用门禁。未设置 MOON_STUDIO_GATE=on 时放行所有请求（保持可用性，避免误锁死）。
const GATE_ENABLED = process.env.MOON_STUDIO_GATE === "on";
// Moon API 的会话 cookie 名（gin-contrib/sessions 默认 "session"）
const SESSION_COOKIE = process.env.MOON_STUDIO_SESSION_COOKIE || "session";
// 校验通过后的快速通行 cookie，短期有效，减少每次都回源校验；退出登录后最多它到期即失效
const PASS_COOKIE = "ms_pass";
const PASS_TTL_SECONDS = 60;

async function isLoggedIn(request: NextRequest): Promise<boolean> {
    const sessionValue = request.cookies.get(SESSION_COOKIE)?.value;
    if (!sessionValue) return false;
    try {
        const res = await fetch(VERIFY_URL, {
            headers: { cookie: `${SESSION_COOKIE}=${sessionValue}` },
            // 不缓存，保证实时反映登录状态
            cache: "no-store",
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { success?: boolean };
        return data?.success === true;
    } catch {
        return false;
    }
}

function blockedResponse(): NextResponse {
    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Moon Studio</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#e5e5e5;font-family:system-ui,-apple-system,sans-serif}main{text-align:center;padding:24px}h1{font-size:20px;margin:0 0 12px}p{color:#a3a3a3;margin:0 0 20px}a{color:#8b5cf6;text-decoration:none}</style></head><body><main><h1>请登录 Moon API 后进入 Moon Studio</h1><p>Moon Studio 需要 Moon API 登录账号访问，请勿直接打开本页面。</p><a href="https://api.moonisapi.com">前往 Moon API →</a></main></body></html>`;
    return new NextResponse(html, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function middleware(request: NextRequest) {
    // 门禁未启用：放行（保持可用性）
    if (!GATE_ENABLED) return NextResponse.next();

    // 快速通行 cookie 有效期内直接放行，避免每个请求都回源校验
    if (request.cookies.get(PASS_COOKIE)?.value === "1") {
        return NextResponse.next();
    }

    if (await isLoggedIn(request)) {
        const response = NextResponse.next();
        response.cookies.set(PASS_COOKIE, "1", {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            maxAge: PASS_TTL_SECONDS,
        });
        return response;
    }

    return blockedResponse();
}

// 只拦截页面与画布自身 API，放行静态资源
export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|css|js|map)).*)"],
};
