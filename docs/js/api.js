// GAS 호출. text/plain으로 보내야 CORS 사전 요청이 생기지 않습니다 (PRD 6.3).
import { CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'network' | 'request_failed' | 'try_later'
  }
}

export async function call(action, body = {}) {
  let res;
  try {
    res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, action }),
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit', // 구글 로그인 쿠키를 보내지 않음
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) throw new ApiError('network');
  let data;
  try { data = await res.json(); } catch { throw new ApiError('network'); }
  if (!data || data.ok !== true) throw new ApiError((data && data.error) || 'request_failed');
  return data;
}

/** 인증이 필요한 요청에 붙이는 값 */
export function authOf(identity) {
  return { userId: identity.userId, deviceId: identity.deviceId, deviceToken: identity.deviceToken };
}
