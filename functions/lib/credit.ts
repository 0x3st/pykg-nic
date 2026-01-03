// LinuxDO Credit API client (EasyPay compatible)

import { createHash } from 'crypto';

const CREDIT_API_BASE = 'https://credit.linux.do/epay';

export interface CreditConfig {
  pid: string;      // Client ID
  key: string;      // Client Secret
  notifyUrl: string;
  returnUrl: string;
}

export interface CreateOrderParams {
  outTradeNo: string;   // 业务单号
  name: string;         // 标题
  money: number;        // 积分数量
}

export interface OrderQueryResult {
  code: number;
  msg: string;
  trade_no: string;
  out_trade_no: string;
  type: string;
  pid: string;
  addtime: string;
  endtime: string;
  name: string;
  money: string;
  status: number;  // 1=成功, 0=失败/处理中
}

export interface NotifyParams {
  pid: string;
  trade_no: string;
  out_trade_no: string;
  type: string;
  name: string;
  money: string;
  trade_status: string;
  sign_type: string;
  sign: string;
}

// Generate MD5 signature
function generateSign(params: Record<string, string>, secret: string): string {
  // 1. Filter out empty values and sign/sign_type
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'sign' && key !== 'sign_type') {
      filtered[key] = value;
    }
  }

  // 2. Sort by ASCII order
  const sortedKeys = Object.keys(filtered).sort();

  // 3. Build query string
  const queryString = sortedKeys.map(k => `${k}=${filtered[k]}`).join('&');

  // 4. Append secret and MD5
  const signString = queryString + secret;

  // Use Web Crypto API for MD5
  return md5(signString);
}

// Simple MD5 implementation using Web Crypto isn't available, use manual implementation
function md5(str: string): string {
  // MD5 implementation for Cloudflare Workers
  // Using a simple approach with TextEncoder
  const encoder = new TextEncoder();
  const data = encoder.encode(str);

  // MD5 constants
  const k = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
    0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
    0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
    0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
    0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  function leftRotate(x: number, c: number): number {
    return ((x << c) | (x >>> (32 - c))) >>> 0;
  }

  // Pre-processing: adding padding bits
  const originalLength = data.length;
  const bitLength = originalLength * 8;

  // Append "1" bit and padding zeros
  const paddingLength = ((56 - (originalLength + 1) % 64) + 64) % 64;
  const paddedLength = originalLength + 1 + paddingLength + 8;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[originalLength] = 0x80;

  // Append original length in bits as 64-bit little-endian
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, 0, true);

  // Initialize hash values
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Process each 64-byte chunk
  for (let i = 0; i < paddedLength; i += 64) {
    const chunk = new DataView(padded.buffer, i, 64);
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = chunk.getUint32(j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16) {
        F = (B & C) | ((~B >>> 0) & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | ((~D >>> 0) & C);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) % 16;
      } else {
        F = C ^ (B | (~D >>> 0));
        g = (7 * j) % 16;
      }

      F = (F + A + k[j] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + leftRotate(F, s[j])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // Convert to hex string (little-endian)
  function toHex(n: number): string {
    const bytes = [
      n & 0xff,
      (n >>> 8) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 24) & 0xff
    ];
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

export class LinuxDOCreditClient {
  private config: CreditConfig;

  constructor(config: CreditConfig) {
    this.config = config;
  }

  // Create payment order and get form parameters (for POST submit)
  createOrderParams(params: CreateOrderParams): Record<string, string> {
    const formParams: Record<string, string> = {
      pid: this.config.pid,
      type: 'epay',
      out_trade_no: params.outTradeNo,
      name: params.name,
      money: params.money.toFixed(2),
      notify_url: this.config.notifyUrl,
      return_url: this.config.returnUrl,
    };

    // Generate signature
    const sign = generateSign(formParams, this.config.key);

    // Return all params including signature
    return {
      ...formParams,
      sign,
      sign_type: 'MD5',
    };
  }

  // Get submit URL (for form action)
  getSubmitUrl(): string {
    return `${CREDIT_API_BASE}/pay/submit.php`;
  }

  // Query order status
  async queryOrder(tradeNo: string, outTradeNo?: string): Promise<OrderQueryResult | null> {
    const url = new URL(`${CREDIT_API_BASE}/api.php`);
    url.searchParams.set('act', 'order');
    url.searchParams.set('pid', this.config.pid);
    url.searchParams.set('key', this.config.key);
    url.searchParams.set('trade_no', tradeNo);
    if (outTradeNo) {
      url.searchParams.set('out_trade_no', outTradeNo);
    }

    try {
      console.log('[Credit API] Querying order:', { tradeNo, outTradeNo });

      // Add browser-like headers to avoid 403
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://credit.linux.do/',
        }
      });

      if (!response.ok) {
        console.error('[Credit API] HTTP error:', response.status, response.statusText);
        const body = await response.text();
        console.error('[Credit API] Response body:', body);
        return null;
      }

      const data = await response.json() as OrderQueryResult;
      console.log('[Credit API] Query response:', {
        code: data.code,
        status: data.status,
        msg: data.msg
      });

      return data;
    } catch (e) {
      console.error('[Credit API] Query failed:', e);
      return null;
    }
  }

  // Refund order
  async refundOrder(tradeNo: string, money: number, outTradeNo?: string): Promise<{ success: boolean; msg: string }> {
    const params: Record<string, string> = {
      act: 'refund',
      pid: this.config.pid,
      key: this.config.key,
      trade_no: tradeNo,
      money: money.toFixed(2),
    };
    if (outTradeNo) {
      params.out_trade_no = outTradeNo;
    }

    try {
      console.log('[Credit API] Refunding order:', { tradeNo, outTradeNo, money });

      // Use POST with application/x-www-form-urlencoded (traditional form format)
      const response = await fetch(`${CREDIT_API_BASE}/api.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://credit.linux.do/',
        },
        body: new URLSearchParams(params).toString(),
      });

      const responseText = await response.text();
      console.log('[Credit API] Refund response status:', response.status);
      console.log('[Credit API] Refund response text:', responseText.substring(0, 500));

      // Check if response is HTML (error page)
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        console.error('[Credit API] Received HTML instead of JSON, API may be unavailable');
        return {
          success: false,
          msg: '退款接口被 Cloudflare 保护，请联系管理员手动退款',
        };
      }

      try {
        const data = JSON.parse(responseText) as { code: number; msg: string };
        console.log('[Credit API] Refund parsed response:', data);

        return {
          success: data.code === 1,
          msg: data.msg,
        };
      } catch (parseError) {
        console.error('[Credit API] Failed to parse response:', parseError);
        return {
          success: false,
          msg: '退款接口返回格式错误，请联系管理员',
        };
      }
    } catch (e) {
      console.error('[Credit API] Refund failed:', e);
      return {
        success: false,
        msg: `退款请求失败: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // Verify callback signature
  verifyNotify(params: NotifyParams): boolean {
    const paramsObj: Record<string, string> = {
      pid: params.pid,
      trade_no: params.trade_no,
      out_trade_no: params.out_trade_no,
      type: params.type,
      name: params.name,
      money: params.money,
      trade_status: params.trade_status,
    };

    const expectedSign = generateSign(paramsObj, this.config.key);
    return expectedSign.toLowerCase() === params.sign.toLowerCase();
  }
}

// Generate unique order number
export function generateOrderNo(): string {
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');

  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PYKG${timestamp}${random}`;
}
