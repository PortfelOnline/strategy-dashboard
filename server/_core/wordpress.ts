import axios from 'axios';
import https from 'https';
import FormData from 'form-data';
import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
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
  title: string;
  slug: string;
}

function basicAuth(username: string, appPassword: string): string {
  return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
}

function apiBase(siteUrl: string): string {
  return siteUrl.replace(/\/$/, '') + '/wp-json/wp/v2';
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
    const response = await axios.get(`${apiBase(siteUrl)}/posts`, {
      params: { slug, _fields: 'id,title,slug,link', per_page: 1 },
      headers: { Authorization: basicAuth(username, appPassword) },
    });
    const posts = response.data;
    if (!Array.isArray(posts) || posts.length === 0) return null;
    const p = posts[0];
    return { id: p.id, title: p.title?.rendered || p.title, slug: p.slug, link: p.link };
  } catch (error: any) {
    console.error('[WordPress API] findPostBySlug error:', error?.response?.data?.message || error?.message);
    return null;
  }
}

/**
 * Upload an image (by URL) to WordPress media library.
 * Uses SSH+WP-CLI sideload when WP_SSH_HOST is configured (server-side download,
 * avoids LibreSSL bad_record_mac when uploading large binaries from macOS).
 * Falls back to direct curl upload otherwise.
 */
export async function uploadMediaFromUrl(
  siteUrl: string,
  username: string,
  appPassword: string,
  imageUrl: string,
  filename: string
): Promise<{ id: number; url: string }> {
  // file:// paths come from Fireworks binary image generation — upload directly
  if (imageUrl.startsWith('file://')) {
    return uploadMediaViaCurl(siteUrl, username, appPassword, imageUrl, filename);
  }
  // Pexels CDN blocks server-side requests — download locally and upload via curl
  if (imageUrl.includes('images.pexels.com')) {
    return uploadMediaViaCurl(siteUrl, username, appPassword, imageUrl, filename);
  }
  if (ENV.wpSshHost) {
    return uploadMediaViaSsh(siteUrl, username, appPassword, imageUrl, filename);
  }
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
    const { readFileSync } = await import('fs');
    buffer = readFileSync(imageUrl.replace('file://', ''));
    mimeType = imageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';
  } else {
    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    buffer = Buffer.from(imgResponse.data);
    mimeType = (imgResponse.headers['content-type'] as string) || 'image/jpeg';
  }

  const tmpFile = path.join(tmpdir(), `wp-upload-${Date.now()}.jpg`);
  try {
    writeFileSync(tmpFile, buffer);
    const result = execFileSync('curl', [
      '-s', '-X', 'POST',
      `${apiBase(siteUrl)}/media`,
      '-u', `${username}:${appPassword}`,
      '-H', `Content-Disposition: attachment; filename="${filename}"`,
      '-H', `Content-Type: ${mimeType}`,
      '--data-binary', `@${tmpFile}`,
      '--max-time', '60',
    ]);
    // Strip BOM that WordPress REST API sometimes prepends
    const data = JSON.parse(result.toString().replace(/^\uFEFF/, '')) as { id: number; source_url: string };
    if (!data.id) throw new Error(`WP media upload: no id in response: ${result.toString().slice(0, 200)}`);
    return { id: data.id, url: data.source_url };
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * Update an existing WP post
 */
export async function updatePost(
  siteUrl: string,
  username: string,
  appPassword: string,
  postId: number,
  data: { title?: string; content?: string; excerpt?: string; featured_media?: number; categories?: number[]; meta?: Record<string, string> }
): Promise<WpPost> {
  try {
    const response = await axios.post(
      `${apiBase(siteUrl)}/posts/${postId}`,
      data,
      {
        headers: {
          Authorization: basicAuth(username, appPassword),
          'Content-Type': 'application/json',
        },
      }
    );
    return { id: response.data.id, link: response.data.link };
  } catch (error: any) {
    const msg = error?.response?.data?.message || error?.message || 'Update failed';
    throw new Error(`WordPress update failed: ${msg}`);
  }
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
