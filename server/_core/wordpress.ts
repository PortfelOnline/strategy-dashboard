import axios from 'axios';
import https from 'https';
import FormData from 'form-data';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ENV } from './env';

// Custom HTTPS agent: disable keepAlive + ignore cert errors for WP media upload
// Fixes SSL bad_record_mac errors when uploading large binary payloads
const wpHttpsAgent = new https.Agent({ keepAlive: false, rejectUnauthorized: false });

export interface WpUserInfo {
  name: string;
  url: string;
}

export interface WpPost {
  id: number;
  link: string;
}

export interface WpPostFull extends WpPost {
  title: string | { rendered: string };
  slug: string;
  content?: { rendered: string };
  excerpt?: { rendered: string };
}

function basicAuth(username: string, appPassword: string): string {
  return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
}

function apiBase(siteUrl: string): string {
  return siteUrl.replace(/\/$/, '') + '/wp-json/wp/v2';
}

function webpFilename(filename: string): string {
  return filename.replace(/\.[^.\/]+$/, '') + '.webp';
}

function imageExtension(mimeType: string, source: string): string {
  if (/webp/i.test(mimeType) || /\.webp(?:$|\?)/i.test(source)) return 'webp';
  if (/png/i.test(mimeType) || /\.png(?:$|\?)/i.test(source)) return 'png';
  return 'jpg';
}

/**
 * Verify credentials by calling /wp-json/wp/v2/users/me
 */
export async function testConnection(
  siteUrl: string,
  username: string,
  appPassword: string
): Promise<WpUserInfo> {
  try {
    const response = await axios.get(`${apiBase(siteUrl)}/users/me`, {
      headers: { Authorization: basicAuth(username, appPassword) },
    });
    return { name: response.data.name, url: response.data.url || siteUrl };
  } catch (error: any) {
    const msg = error?.response?.data?.message || error?.message || 'Connection failed';
    console.error('[WordPress API] testConnection error:', msg);
    throw new Error(`WordPress connection failed: ${msg}`);
  }
}

/**
 * Find a WP post by URL slug
 */
export async function findPostBySlug(
  siteUrl: string,
  username: string,
  appPassword: string,
  slug: string
): Promise<WpPostFull | null> {
  try {
    const response = await axios.get(`${apiBase(siteUrl)}/posts/`, {
      params: { slug, _fields: 'id,title,slug,link,content,excerpt', per_page: 1 },
      headers: { Authorization: basicAuth(username, appPassword) },
      proxy: false,  // don't route WP reads through the SERP proxy (avoids 400)
    });
    const posts = response.data;
    if (!Array.isArray(posts) || posts.length === 0) return null;
    const p = posts[0];
    return { id: p.id, title: p.title?.rendered || p.title, slug: p.slug, link: p.link, content: p.content, excerpt: p.excerpt };
  } catch (error: any) {
    console.error('[WordPress API] findPostBySlug error:', error?.response?.data?.message || error?.message);
    return null;
  }
}

/**
 * Upload an image (by URL) to WordPress media library.
 * Downloads the source image locally, converts it to WebP, then uploads it via curl.
 */
export async function uploadMediaFromUrl(
  siteUrl: string,
  username: string,
  appPassword: string,
  imageUrl: string,
  filename: string
): Promise<{ id: number; url: string }> {
  return uploadMediaViaCurl(siteUrl, username, appPassword, imageUrl, filename);
}

/**
 * Sideload image via SSH+PHP: image is downloaded server-side by PHP curl,
 * then registered in WP media library. Avoids macOS LibreSSL bad_record_mac
 * on large binary POSTs.
 *
 * Requires /root/wp-tools/sideload.php on the remote server.
 */
async function uploadMediaViaSsh(
  siteUrl: string,
  username: string,
  appPassword: string,
  imageUrl: string,
  filename: string
): Promise<{ id: number; url: string }> {
  // Escape single quotes in imageUrl and filename for the shell command
  const safeUrl = imageUrl.replace(/'/g, "'\\''");
  const safeFilename = filename.replace(/'/g, "'\\''");
  const safeTitle = filename.replace(/\.[^.]+$/, '').replace(/'/g, "'\\''");

  const result = execFileSync('ssh', [
    '-i', `${process.env.HOME}/.ssh/id_ed25519`,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=15',
    ENV.wpSshHost,
    `php7.4 /root/wp-tools/sideload.php '${safeUrl}' '${safeTitle}' '${safeFilename}' 2>/dev/null`,
  ], { timeout: 90_000 });

  const output = result.toString().trim();
  const mediaId = parseInt(output, 10);
  if (!mediaId || isNaN(mediaId)) {
    throw new Error(`WP sideload failed: ${output.slice(0, 300)}`);
  }

  // Fetch the attachment URL via REST API
  const res = await axios.get(`${apiBase(siteUrl)}/media/${mediaId}`, {
    headers: { Authorization: basicAuth(username, appPassword) },
  });
  return { id: mediaId, url: res.data.source_url };
}

/**
 * Fallback: upload image binary via curl subprocess.
 */
async function uploadMediaViaCurl(
  siteUrl: string,
  username: string,
  appPassword: string,
  imageUrl: string,
  filename: string
): Promise<{ id: number; url: string }> {
  let buffer: Buffer;
  let mimeType: string;

  if (imageUrl.startsWith('file://')) {
    const filePath = imageUrl.replace('file://', '');
    buffer = readFileSync(filePath);
    mimeType = filePath.endsWith('.webp') ? 'image/webp' : filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  } else {
    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000, proxy: false });
    buffer = Buffer.from(imgResponse.data);
    mimeType = (imgResponse.headers['content-type'] as string) || 'image/jpeg';
  }

  const tmpBase = path.join(tmpdir(), `wp-upload-${Date.now()}`);
  const tmpInput = `${tmpBase}.${imageExtension(mimeType, imageUrl)}`;
  const tmpWebp = `${tmpBase}.webp`;
  const uploadFilename = webpFilename(filename);
  try {
    if (/image\/webp/i.test(mimeType) || /\.webp(?:$|\?)/i.test(imageUrl)) {
      writeFileSync(tmpWebp, buffer);
    } else {
      writeFileSync(tmpInput, buffer);
      execFileSync('cwebp', ['-quiet', '-q', '82', tmpInput, '-o', tmpWebp], { timeout: 60_000 });
    }
    const result = execFileSync('curl', [
      '-s', '-X', 'POST',
      `${apiBase(siteUrl)}/media/`,
      '-u', `${username}:${appPassword}`,
      '-H', `Content-Disposition: attachment; filename="${uploadFilename}"`,
      '-H', 'Content-Type: image/webp',
      '--data-binary', `@${tmpWebp}`,
      '--max-time', '60',
      // curl reads HTTPS_PROXY env automatically → bypass: WP API must go direct
      '--noproxy', '*',
    ]);
    // Strip BOM that WordPress REST API sometimes prepends
    const data = JSON.parse(result.toString().replace(/^\uFEFF/, '')) as { id: number; source_url: string };
    if (!data.id) throw new Error(`WP media upload: no id in response: ${result.toString().slice(0, 200)}`);
    return { id: data.id, url: data.source_url };
  } finally {
    try { unlinkSync(tmpInput); } catch { /* ignore */ }
    try { unlinkSync(tmpWebp); } catch { /* ignore */ }
  }
}

/**
 * Update an existing WP post
 */
/** Strip characters that make WP REST return "Invalid JSON body":
 *  - null byte, control chars (except \t \n \r) are illegal in JSON values
 *  - orphan surrogate halves (broken UTF-16 from LLM) break JSON.parse on server
 */
function sanitizeForJson(v: unknown): unknown {
  if (typeof v === 'string') {
    return v
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')   // control chars
      // Orphan surrogates only — valid emoji pairs (e.g. 🕐 = D83D+DD50) preserved.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')                // unpaired high surrogate
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');               // unpaired low surrogate
  }
  if (Array.isArray(v)) return v.map(sanitizeForJson);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = sanitizeForJson(val);
    return out;
  }
  return v;
}

export async function updatePost(
  siteUrl: string,
  username: string,
  appPassword: string,
  postId: number,
  data: { title?: string; content?: string; excerpt?: string; featured_media?: number; categories?: number[]; meta?: Record<string, string> }
): Promise<WpPost> {
  // Pre-sanitize: remove illegal control chars / orphan surrogates that
  // LLM output occasionally contains. These pass JSON.stringify but WP's
  // json_decode rejects them with "Invalid JSON body".
  const cleanData = sanitizeForJson(data) as typeof data;
  // Also: serialize manually to guarantee body is a valid JSON string.
  // axios v1 sometimes refuses to stringify or uses qs for certain shapes.
  const body = JSON.stringify(cleanData);
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(
        // Trailing slash is REQUIRED: without it nginx 301-redirects /posts/<id> →
        // /posts/<id>/ (and https→http), and axios/follow-redirects converts the POST
        // to a GET, silently dropping the body — the update becomes a no-op that still
        // returns 200. maxRedirects:0 makes any future redirect throw loudly instead of
        // silently swallowing writes. (Incident 2026-06-07: all article updates were no-ops.)
        `${apiBase(siteUrl)}/posts/${postId}/`,
        body,
        {
          headers: {
            Authorization: basicAuth(username, appPassword),
            'Content-Type': 'application/json; charset=utf-8',
          },
          transformRequest: [(d) => d],  // body is already a string — don't re-stringify
          httpsAgent: new https.Agent({ keepAlive: false, rejectUnauthorized: false }),
          maxRedirects: 0,
          proxy: false,  // never route WP writes through the SERP proxy
        }
      );
      return { id: response.data.id, link: response.data.link };
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || 'Update failed';
      lastErr = new Error(`WordPress update failed: ${msg}`);
      if (attempt < 3) {
        const delay = attempt * 2000;
        console.warn(`[WP] updatePost attempt ${attempt} failed (${msg.slice(0, 60)}), retry in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr!;
}

/**
 * Create a 301 redirect via the Redirection plugin REST API
 * Plugin: https://wordpress.org/plugins/redirection/
 */
export async function createRedirect(
  siteUrl: string,
  username: string,
  appPassword: string,
  sourceUrl: string,  // relative path, e.g. "/old-article/"
  targetUrl: string,  // full URL
): Promise<{ id: number }> {
  const base = siteUrl.replace(/\/$/, '');
  try {
    const response = await axios.post(
      `${base}/wp-json/redirection/v1/redirect`,
      {
        source_url: sourceUrl,
        target_url: targetUrl,
        code: 301,
        match_url: 'url',
        action_type: 'url',
        action_code: 301,
        status: 'enabled',
      },
      {
        headers: {
          Authorization: basicAuth(username, appPassword),
          'Content-Type': 'application/json',
        },
      }
    );
    return { id: response.data.id };
  } catch (error: any) {
    const msg = error?.response?.data?.message || error?.message || 'Redirect creation failed';
    console.error('[WordPress API] createRedirect error:', msg);
    throw new Error(`WordPress redirect failed: ${msg}`);
  }
}

/**
 * Search WP media library by keyword — returns up to `perPage` items.
 * Used to find relevant thematic images before falling back to DALL-E generation.
 */
export async function searchMedia(
  siteUrl: string,
  username: string,
  appPassword: string,
  keyword: string,
  perPage = 10
): Promise<{ id: number; url: string; width: number; height: number; alt: string; title: string }[]> {
  try {
    const response = await axios.get(`${apiBase(siteUrl)}/media`, {
      params: {
        search: keyword,
        per_page: perPage,
        media_type: 'image',
        _fields: 'id,source_url,alt_text,title,media_details',
      },
      headers: { Authorization: basicAuth(username, appPassword) },
    });
    return (response.data as any[]).map((item) => ({
      id: item.id,
      url: item.source_url,
      width: item.media_details?.width ?? 0,
      height: item.media_details?.height ?? 0,
      alt: item.alt_text || item.title?.rendered || '',
      title: item.title?.rendered || '',
    }));
  } catch (e: any) {
    console.warn('[WordPress API] searchMedia error:', e?.message);
    return [];
  }
}

/**
 * Delete a WP post (move to trash)
 */
export async function deletePost(
  siteUrl: string,
  username: string,
  appPassword: string,
  postId: number,
): Promise<void> {
  try {
    await axios.delete(`${apiBase(siteUrl)}/posts/${postId}`, {
      headers: { Authorization: basicAuth(username, appPassword) },
    });
  } catch (error: any) {
    const msg = error?.response?.data?.message || error?.message || 'Delete failed';
    throw new Error(`WordPress delete failed: ${msg}`);
  }
}

/**
 * Publish a post via /wp-json/wp/v2/posts
 */
export async function publishPost(
  siteUrl: string,
  username: string,
  appPassword: string,
  post: { title: string; content: string; status: 'publish' | 'draft' }
): Promise<WpPost> {
  try {
    const response = await axios.post(
      `${apiBase(siteUrl)}/posts`,
      {
        title: post.title,
        content: post.content,
        status: post.status,
      },
      {
        headers: {
          Authorization: basicAuth(username, appPassword),
          'Content-Type': 'application/json',
        },
      }
    );
    return { id: response.data.id, link: response.data.link };
  } catch (error: any) {
    const msg = error?.response?.data?.message || error?.message || 'Publish failed';
    console.error('[WordPress API] publishPost error:', msg);
    throw new Error(`WordPress publish failed: ${msg}`);
  }
}

/**
 * Update ACF/post meta fields via SSH+PHP (ACF Free doesn't expose fields via REST API).
 * Falls back to no-op when WP_SSH_HOST is not configured.
 */
export function updatePostMetaSsh(postId: number, meta: Record<string, string>): void {
  if (!ENV.wpSshHost) return;

  const pairs = Object.entries(meta)
    .map(([k, v]) => `update_post_meta(${postId}, '${k.replace(/'/g, "\\'")}', '${v.replace(/'/g, "\\'")}');`)
    .join(' ');

  const php = `<?php
define('DOING_CRON', true);
$_SERVER['HTTP_HOST'] = 'kadastrmap.info';
$_SERVER['HTTPS'] = 'on';
require_once('${ENV.wpSshWpPath}wp-load.php');
${pairs}
echo 'ok';
`;

  const tmpFile = path.join(tmpdir(), `wp_meta_${postId}_${Date.now()}.php`);
  try {
    writeFileSync(tmpFile, php);
    execFileSync('scp', ['-i', `${process.env.HOME}/.ssh/id_ed25519`, '-o', 'StrictHostKeyChecking=no', tmpFile, `${ENV.wpSshHost}:${tmpFile}`], { timeout: 15_000 });
    execFileSync('ssh', ['-i', `${process.env.HOME}/.ssh/id_ed25519`, '-o', 'StrictHostKeyChecking=no', ENV.wpSshHost, `php7.4 ${tmpFile} && rm -f ${tmpFile}`], { timeout: 30_000 });
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
