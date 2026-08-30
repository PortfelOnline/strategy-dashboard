import { describe, expect, it } from 'vitest';
import { prioritizeRetryQueue, selectEligibleArticleQueueEntries } from './articleScheduler';

describe('article scheduler image-quota eligibility', () => {
  it('selects a queued existing improvement as text-only when image quota is zero', () => {
    const queued = [{
      url: 'https://100zem.ru/kadastr/proverka-kvartiry/',
      kind: 'improveExisting' as const,
      imagesRequired: 3,
    }];

    expect(selectEligibleArticleQueueEntries(queued, {
      credits: 0,
      flowDisabled: true,
    })).toEqual([{
      ...queued[0],
      imagesRequired: 0,
    }]);
  });

  it('keeps new evergreen creation rejected when no images are available', () => {
    const queued = [{
      url: 'https://100zem.ru/kadastr/novaya-tema/',
      kind: 'createNewEvergreen' as const,
      imagesRequired: 1,
    }];

    expect(selectEligibleArticleQueueEntries(queued, {
      credits: 0,
      flowDisabled: true,
    })).toEqual([]);
  });

  it('keeps catalog improvements text-only even when a later image refresh has quota', () => {
    const queued = [{
      url: 'https://100zem.ru/kadastr/kadastrovyj-plan-doma/',
      kind: 'improveExisting' as const,
    }];

    expect(selectEligibleArticleQueueEntries(queued, { credits: 10 })).toEqual([{
      ...queued[0],
      imagesRequired: 0,
    }]);
  });

  it('prioritizes failed URLs even when analysis history marks them recent', () => {
    expect(prioritizeRetryQueue(
      ['https://100zem.ru/failed/'],
      10,
    )).toEqual(['https://100zem.ru/failed/']);
  });
});
