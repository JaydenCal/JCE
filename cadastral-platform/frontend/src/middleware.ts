import { NextResponse, type NextRequest } from "next/server";
/** Cheap guard: protected routes need the `jce_terms` cookie (set after acceptance / when the API reports accepted).
 *  The API remains the source of truth (403 TERMS_NOT_ACCEPTED -> client interceptor redirects too). */
export function middleware(req: NextRequest) {
  if (req.cookies.get("jce_terms")?.value) return NextResponse.next();
  const url = req.nextUrl.clone(); url.pathname = "/legal/terms"; url.search = "?next=" + encodeURIComponent(req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/projects/:path*"] };
