import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { jwtVerify, SignJWT } from "jose";

import { db } from "./db/client.js";
import { users } from "./db/schema.js";
import { env } from "./env.js";

export const COOKIE = "flow_session";
const key = new TextEncoder().encode(env.JWT_SECRET);
const TTL_HOURS = 8;

export interface SessionUser {
  userId: number;
  employeeId: number;
  email: string;
  roles: string[];
}

export type AppEnv = { Variables: { user: SessionUser } };

export async function login(c: Context, email: string, password: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
    throw new HTTPException(401, { message: "Email or password is incorrect" });
  }
  const token = await new SignJWT({ sub: String(u.id) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_HOURS}h`)
    .sign(key);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE === "true",
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_HOURS * 3600,
  });
  return u;
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE) ?? c.req.header("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HTTPException(401, { message: "Not signed in" });
  let sub: string | undefined;
  try {
    ({ payload: { sub } } = await jwtVerify(token, key));
  } catch {
    throw new HTTPException(401, { message: "Your session has ended" });
  }
  const [u] = await db.select().from(users).where(eq(users.id, Number(sub)));
  if (!u) throw new HTTPException(401, { message: "Account no longer exists" });
  c.set("user", { userId: u.id, employeeId: u.employeeId, email: u.email, roles: u.roles });
  await next();
};

export function hasRole(user: SessionUser, ...roles: string[]) {
  return roles.some((r) => user.roles.includes(r));
}

export function requireRole(...roles: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!hasRole(c.get("user"), ...roles)) throw new HTTPException(403, { message: "Your role cannot do this" });
    await next();
  };
}
