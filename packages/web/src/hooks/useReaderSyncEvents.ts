import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCapabilities } from './useCapabilities';
import { refreshArticleStates } from '../articleState';
import { subscribeReaderEvents } from '../readerEvents';

/** Legacy reader apps share article state and subscription identities with the UI. */
export function useReaderSyncEvents() {
  const client = useQueryClient();
  const caps = useCapabilities();
  useEffect(() => {
    if (!caps.data?.readerApi) return;
    return subscribeReaderEvents({
      'reader:sync': () => {
        refreshArticleStates(client);
        for (const key of [
          'feeds',
          'folders',
          'source-feeds',
          'source-folders',
          'tags',
          'newsletter-overview',
          'agent-activity',
        ])
          void client.invalidateQueries({ queryKey: [key] });
      },
    });
  }, [client, caps.data?.readerApi]);
}
