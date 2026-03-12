import { getDueScheduledPosts, updateContentPost } from './db';
import * as metaDb from './meta.db';
import * as metaApi from './_core/meta';

async function runScheduler() {
  try {
    const posts = await getDueScheduledPosts();
    if (posts.length === 0) return;

    console.log(`[ContentScheduler] Processing ${posts.length} due post(s)`);

    for (const post of posts) {
      const accounts = await metaDb.getUserMetaAccounts(post.userId);
      const platformAccountType =
        post.platform === 'instagram' ? 'instagram_business' : 'facebook_page';
      const account = accounts.find(
        (a) => a.accountType === platformAccountType && a.isActive
      );

      if (!account || (post.platform !== 'instagram' && post.platform !== 'facebook')) {
        // WhatsApp/YouTube or no account connected — just flip to published
        await updateContentPost(post.userId, post.id, {
          status: 'published',
          publishedAt: new Date(),
        });
        console.log(`[ContentScheduler] Marked post ${post.id} as published (no Meta account)`);
        continue;
      }

      try {
        const text = [post.content, post.hashtags].filter(Boolean).join('\n\n');

        if (post.platform === 'instagram') {
          await metaApi.postToInstagram(
            account.accountId,
            account.accessToken,
            text,
            post.mediaUrl ?? undefined
          );
        } else {
          await metaApi.postToFacebookPage(
            account.accountId,
            account.accessToken,
            text,
            post.mediaUrl ?? undefined
          );
        }

        await updateContentPost(post.userId, post.id, {
          status: 'published',
          publishedAt: new Date(),
        });
        console.log(`[ContentScheduler] Published post ${post.id} → ${post.platform}`);
      } catch (err) {
        console.error(`[ContentScheduler] Failed to publish post ${post.id}:`, err);
        // Put back to draft so the user can retry manually
        await updateContentPost(post.userId, post.id, { status: 'draft' });
      }
    }
  } catch (err) {
    console.error('[ContentScheduler] Unexpected error:', err);
  }
}

export function initContentScheduler() {
  // Run once immediately on startup to catch any posts missed during downtime
  runScheduler();
  setInterval(() => runScheduler(), 60_000);
  console.log('[ContentScheduler] Started — checking every 60s');
}
