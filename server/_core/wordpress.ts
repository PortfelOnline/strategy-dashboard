import axios from 'axios';

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
 * Upload an image (by URL) to WordPress media library
 */
export async function uploadMediaFromUrl(
  siteUrl: string,
  username: string,
  appPassword: string,
  imageUrl: string,
  filename: string
): Promise<{ id: number; url: string }> {
  // Download image
  const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const buffer = Buffer.from(imgResponse.data);
  const mimeType = (imgResponse.headers['content-type'] as string) || 'image/jpeg';

  const response = await axios.post(`${apiBase(siteUrl)}/media`, buffer, {
    headers: {
      Authorization: basicAuth(username, appPassword),
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return { id: response.data.id, url: response.data.source_url };
}

/**
 * Update an existing WP post
 */
export async function updatePost(
  siteUrl: string,
  username: string,
  appPassword: string,
  postId: number,
  data: { title?: string; content?: string; featured_media?: number }
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
