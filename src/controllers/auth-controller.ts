import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";

import AppError from "../errors/app-error.js";
import * as authService from "../services/auth-service.js";
import * as socialAuthService from "../services/social-auth-service.js";
import * as socialLinkService from "../services/social-link-service.js";
import {
  clearReauthCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromCookie,
  setRefreshTokenCookie,
} from "../utils/auth-cookie.js";
import { serializeBigInt } from "../utils/bigint.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifySocialSignupToken,
} from "../utils/jwt.js";
import { validateLogin, validateSignup } from "../validators/auth-validator.js";
import {
  validateKakaoLink,
  validateKakaoLogin,
  validateKakaoSignup,
  validateGoogleLink,
  validateGoogleLogin,
  validateGoogleSignup,
} from "../validators/social-auth-validator.js";
import type { SocialProvider } from "../types/social.js";

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const input = validateSignup(req.body);
    const user = await authService.signup(input);

    const payload = { sub: user.id.toString(), role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    setRefreshTokenCookie(res, refreshToken);
    res.status(201).json(serializeBigInt({ accessToken, user }));
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const input = validateLogin(req.body);
    const user = await authService.login(input);

    const payload = { sub: user.id.toString(), role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    setRefreshTokenCookie(res, refreshToken);
    res.status(200).json(serializeBigInt({ accessToken, user }));
  } catch (error) {
    next(error);
  }
}

function sendSocialLoginResult(res: Response, result: socialAuthService.KakaoAuthResult) {
  if (result.isNewUser) {
    res.status(200).json({ isNewUser: true, signupToken: result.signupToken });
    return;
  }

  const { user } = result;
  const payload = { sub: user.id.toString(), role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  setRefreshTokenCookie(res, refreshToken);
  res.status(200).json(serializeBigInt({ isNewUser: false, accessToken, user }));
}

export async function kakaoLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const input = validateKakaoLogin(req.body);
    sendSocialLoginResult(res, await socialAuthService.authenticateWithKakao(input));
  } catch (error) {
    next(error);
  }
}

export async function googleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const input = validateGoogleLogin(req.body);
    sendSocialLoginResult(res, await socialAuthService.authenticateWithGoogle(input));
  } catch (error) {
    next(error);
  }
}

function getBearerToken(req: Request): string | undefined {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  return scheme === "Bearer" && token ? token : undefined;
}

async function handleSocialSignup(
  req: Request,
  res: Response,
  next: NextFunction,
  provider: SocialProvider,
  validate: (body: unknown) => { password: string },
) {
  try {
    const token = getBearerToken(req);
    const signupPayload = token ? verifySocialSignupToken(token) : null;
    if (!signupPayload || signupPayload.provider !== provider) {
      throw new AppError("SOCIAL_SIGNUP_TOKEN_INVALID");
    }

    const { password } = validate(req.body);
    const user = await socialAuthService.completeSocialSignup(signupPayload, password);

    const payload = { sub: user.id.toString(), role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    setRefreshTokenCookie(res, refreshToken);
    res.status(201).json(serializeBigInt({ accessToken, user }));
  } catch (error) {
    next(error);
  }
}

export function kakaoSignup(req: Request, res: Response, next: NextFunction) {
  return handleSocialSignup(req, res, next, "KAKAO", validateKakaoSignup);
}

export function googleSignup(req: Request, res: Response, next: NextFunction) {
  return handleSocialSignup(req, res, next, "GOOGLE", validateGoogleSignup);
}

export async function linkKakao(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const input = validateKakaoLink(req.body);
    await socialLinkService.connectKakaoAccount(req.user, input);

    res.status(201).json({ provider: "KAKAO" });
  } catch (error) {
    next(error);
  }
}

export async function linkGoogle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const input = validateGoogleLink(req.body);
    await socialLinkService.connectGoogleAccount(req.user, input);

    res.status(201).json({ provider: "GOOGLE" });
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response) {
  clearRefreshTokenCookie(res);
  clearReauthCookie(res);
  res.status(200).json({ message: "로그아웃되었습니다." });
}

export function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getRefreshTokenFromCookie(req);
    const payload = token ? verifyRefreshToken(token) : null;
    if (!payload) {
      throw new AppError("REFRESH_TOKEN_INVALID");
    }

    const accessToken = signAccessToken({ sub: payload.sub, role: payload.role });
    res.status(200).json({ accessToken });
  } catch (error) {
    next(error);
  }
}
