import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/registro"];

// request.nextUrl.clone() monta a origem sozinho e, atrás do nginx, acaba
// pegando localhost:<porta interna> em vez do host real que o cliente usou
// — mesmo com o header Host correto chegando. Por isso montamos a URL de
// redirect manualmente a partir dos headers encaminhados pelo proxy.
function redirectTo(request: NextRequest, pathname: string) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return NextResponse.redirect(new URL(pathname, `${proto}://${host}`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("session");
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (!hasSession && !isPublic) {
    return redirectTo(request, "/login");
  }

  if (hasSession && isPublic) {
    return redirectTo(request, "/");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
