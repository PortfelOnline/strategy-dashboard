import axios from 'axios';
import { ENV } from './env';

const META_GRAPH_API_VERSION = 'v18.0';
const META_GRAPH_API_URL = `https://graph.instagram.com/${META_GRAPH_API_VERSION}`;
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
    const response = await axios.post(
      `${META_FACEBOOK_API_URL}/oauth/access_token`,
      {
        client_id: ENV.metaAppId,
        client_secret: ENV.metaAppSecret,
        redirect_uri: ENV.metaRedirectUri,
        code,
      }
    );

    return response.data;
  } catch (error) {
    console.error('[Meta OAuth] Failed to exchange code:', error);
    throw new Error('Failed to authenticate with Meta');
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
    // Create media container first
    const mediaResponse = await axios.post(
      `${META_GRAPH_API_URL}/${instagramAccountId}/media`,
      {
        image_url: imageUrl,
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
    const payload: any = {
      message,
      access_token: accessToken,
    };

    if (imageUrl) {
      payload.picture = imageUrl;
      payload.link = imageUrl;
    }

    const response = await axios.post(
      `${META_FACEBOOK_API_URL}/${pageId}/feed`,
      payload
    );

    return { id: response.data.id };
  } catch (error) {
    console.error('[Meta API] Failed to post to Facebook:', error);
    throw new Error('Failed to post to Facebook');
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

