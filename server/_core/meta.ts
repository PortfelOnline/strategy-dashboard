import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import FormData from 'form-data';
import { ENV } from './env';

const SERVER_N_HOST = 'root@5.42.109.72';
const SERVER_N_UPLOADS_DIR = '/var/www/ai-uploads';
const SERVER_N_PUBLIC_URL = 'https://get-my-agent.com/ai-uploads';
const SSH_KEY = (process.env.HOME || '/root') + '/.ssh/id_ed25519';

/**
 * Upload local image to server n and return public URL for Instagram
 */
export function uploadImageToServerN(localPath: string): string {
  const filename = path.basename(localPath);
  execFileSync('scp', [
    '-i', SSH_KEY,
    '-o', 'StrictHostKeyChecking=no',
    localPath,
    `${SERVER_N_HOST}:${SERVER_N_UPLOADS_DIR}/${filename}`,
  ], { timeout: 30000 });
  return `${SERVER_N_PUBLIC_URL}/${filename}`;
}

const META_GRAPH_API_VERSION = 'v21.0';
const META_GRAPH_API_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;
const META_FACEBOOK_API_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

export interface MetaOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MetaUser {
  id: string;
  name: string;
  email?: string;
}

export interface InstagramAccount {
  id: string;
  username: string;
  name: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  pageAccessToken: string;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  picture?: {
    data: {
      url: string;
    };
  };
}

/**
 * Get OAuth authorization URL for Meta
 */
export function getMetaOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: ENV.metaAppId,
    redirect_uri: ENV.metaRedirectUri,
    scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish',
    state,
    response_type: 'code',
  });

  return `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeMetaCode(code: string): Promise<MetaOAuthTokenResponse> {
  try {
    const params = new URLSearchParams({
      client_id: ENV.metaAppId,
      client_secret: ENV.metaAppSecret,
      redirect_uri: ENV.metaRedirectUri,
      code,
    });
    const response = await axios.get(
      `${META_FACEBOOK_API_URL}/oauth/access_token?${params.toString()}`
    );
    console.log('[Meta OAuth] Token exchange success, token type:', response.data?.token_type);
    return response.data;
  } catch (error: any) {
    console.error('[Meta OAuth] Failed to exchange code:', error?.response?.data || error);
    throw new Error('Failed to authenticate with Meta');
  }
}

/**
 * Exchange short-lived user token for long-lived token (60 days)
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  try {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: ENV.metaAppId,
      client_secret: ENV.metaAppSecret,
      fb_exchange_token: shortLivedToken,
    });
    const response = await axios.get(
      `${META_FACEBOOK_API_URL}/oauth/access_token?${params.toString()}`
    );
    const longLivedToken = response.data?.access_token;
    console.log('[Meta OAuth] Long-lived token obtained, expires_in:', response.data?.expires_in, 'sec');
    return longLivedToken;
  } catch (error: any) {
    console.error('[Meta OAuth] Failed to get long-lived token:', error?.response?.data || error);
    // Fall back to short-lived token if exchange fails
    return shortLivedToken;
  }
}

/**
 * Get user info from Meta
 */
export async function getMetaUser(accessToken: string): Promise<MetaUser> {
  try {
    const response = await axios.get(`${META_FACEBOOK_API_URL}/me`, {
      params: {
        fields: 'id,name,email',
        access_token: accessToken,
      },
    });

    return response.data;
  } catch (error) {
    console.error('[Meta API] Failed to get user:', error);
    throw new Error('Failed to get Meta user info');
  }
}

/**
 * Get Instagram business accounts linked to Facebook pages
 * Correct approach: each FB Page may have a linked instagram_business_account
 */
export async function getInstagramAccountsFromPages(
  userAccessToken: string,
  pages: FacebookPage[]
): Promise<InstagramAccount[]> {
  const accounts: InstagramAccount[] = [];

  for (const page of pages) {
    try {
      const response = await axios.get(
        `${META_FACEBOOK_API_URL}/${page.id}`,
        {
          params: {
            fields: 'instagram_business_account{id,username,name,profile_picture_url,biography,website}',
            access_token: page.access_token,
          },
        }
      );

      const igAccount = response.data?.instagram_business_account;
      if (igAccount?.id) {
        accounts.push({
          ...igAccount,
          username: igAccount.username || igAccount.name || page.name,
          name: igAccount.name || igAccount.username || page.name,
          pageAccessToken: page.access_token,
        });
      }
    } catch (error) {
      console.error(`[Meta API] Failed to get Instagram for page ${page.id}:`, error);
    }
  }

  return accounts;
}

/**
 * @deprecated Use getInstagramAccountsFromPages instead
 */
export async function getInstagramAccounts(accessToken: string): Promise<InstagramAccount[]> {
  return [];
}

/**
 * Get Facebook pages managed by user
 */
export async function getFacebookPages(accessToken: string): Promise<FacebookPage[]> {
  try {
    const response = await axios.get(`${META_FACEBOOK_API_URL}/me/accounts`, {
      params: {
        fields: 'id,name,access_token,picture',
        access_token: accessToken,
      },
    });

    return response.data.data || [];
  } catch (error) {
    console.error('[Meta API] Failed to get Facebook pages:', error);
    return [];
  }
}

/**
 * Post content to Instagram
 */
export async function postToInstagram(
  instagramAccountId: string,
  accessToken: string,
  caption: string,
  imageUrl?: string
): Promise<{ id: string }> {
  try {
    // If imageUrl is a local path, upload to server n to get a public URL
    let publicImageUrl = imageUrl;
    if (imageUrl && imageUrl.startsWith('/uploads/')) {
      const localPath = path.join(process.cwd(), 'public', imageUrl);
      publicImageUrl = uploadImageToServerN(localPath);
      console.log('[Meta] Uploaded image to server n:', publicImageUrl);
    }

    // Create media container first
    const mediaResponse = await axios.post(
      `${META_GRAPH_API_URL}/${instagramAccountId}/media`,
      {
        image_url: publicImageUrl,
        caption,
        access_token: accessToken,
      }
    );

    const mediaId = mediaResponse.data.id;

    // Publish the media
    const publishResponse = await axios.post(
      `${META_GRAPH_API_URL}/${instagramAccountId}/media_publish`,
      {
        creation_id: mediaId,
        access_token: accessToken,
      }
    );

    return { id: publishResponse.data.id };
  } catch (error) {
    console.error('[Meta API] Failed to post to Instagram:', error);
    throw new Error('Failed to post to Instagram');
  }
}

/**
 * Post content to Facebook page
 */
export async function postToFacebookPage(
  pageId: string,
  accessToken: string,
  message: string,
  imageUrl?: string
): Promise<{ id: string }> {
  try {
    if (imageUrl) {
      // imageUrl is a local path like /uploads/visual_xxx.jpg — upload binary to FB
      const localPath = path.join(process.cwd(), 'public', imageUrl);
      const form = new FormData();
      form.append('source', fs.createReadStream(localPath), {
        filename: path.basename(localPath),
        contentType: 'image/jpeg',
      });
      form.append('message', message);
      form.append('published', 'true');
      form.append('access_token', accessToken);

      const response = await axios.post(
        `${META_FACEBOOK_API_URL}/${pageId}/photos`,
        form,
        { headers: form.getHeaders() }
      );
      // post_id is the feed post ID (matches /{page}/feed); id is the photo ID
      return { id: response.data.post_id || response.data.id };
    }

    // Text-only post
    const response = await axios.post(
      `${META_FACEBOOK_API_URL}/${pageId}/feed`,
      { message, access_token: accessToken }
    );
    return { id: response.data.id };
  } catch (error: any) {
    const fbError = error?.response?.data?.error;
    console.error('[Meta API] Failed to post to Facebook:', fbError ?? error);
    throw new Error(fbError?.message ?? 'Failed to post to Facebook');
  }
}

/**
 * Fetch uploaded photos from a Facebook page (for sync — handles posts stored with photo_id)
 */
export async function getPagePhotos(pageId: string, accessToken: string): Promise<Array<{
  id: string;
  link: string;
}>> {
  try {
    const response = await axios.get(`${META_FACEBOOK_API_URL}/${pageId}/photos`, {
      params: {
        fields: 'id,link',
        limit: 100,
        type: 'uploaded',
        access_token: accessToken,
      },
    });
    return (response.data?.data ?? []).filter((p: any) => p.link);
  } catch (error) {
    console.error('[Meta API] Failed to get page photos:', error);
    return [];
  }
}

/**
 * Fetch published posts from a Facebook page (for sync)
 */
export async function getPagePosts(pageId: string, accessToken: string): Promise<Array<{
  id: string;
  permalink_url: string;
  created_time: string;
  message?: string;
}>> {
  try {
    const response = await axios.get(`${META_FACEBOOK_API_URL}/${pageId}/feed`, {
      params: {
        fields: 'id,permalink_url,created_time,message',
        limit: 100,
        access_token: accessToken,
      },
    });
    return response.data?.data ?? [];
  } catch (error) {
    console.error('[Meta API] Failed to get page posts:', error);
    return [];
  }
}

/**
 * Fetch published media from an Instagram business account (for sync)
 */
export async function getInstagramMedia(igAccountId: string, accessToken: string): Promise<Array<{
  id: string;
  permalink: string;
  timestamp: string;
  caption?: string;
}>> {
  try {
    const response = await axios.get(`${META_GRAPH_API_URL}/${igAccountId}/media`, {
      params: {
        fields: 'id,permalink,timestamp,caption',
        limit: 100,
        access_token: accessToken,
      },
    });
    return response.data?.data ?? [];
  } catch (error) {
    console.error('[Meta API] Failed to get Instagram media:', error);
    return [];
  }
}

/**
 * Validate Meta access token
 */
export async function validateMetaToken(accessToken: string): Promise<boolean> {
  try {
    const response = await axios.get(`${META_FACEBOOK_API_URL}/debug_token`, {
      params: {
        input_token: accessToken,
        access_token: `${ENV.metaAppId}|${ENV.metaAppSecret}`,
      },
    });

    return response.data.data?.is_valid === true;
  } catch (error) {
    console.error('[Meta API] Failed to validate token:', error);
    return false;
  }
}

