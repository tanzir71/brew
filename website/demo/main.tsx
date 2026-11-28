import './runtime';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../../packages/web/src/App';
import { IconSprite } from '../../packages/web/src/components/Icon';
import '../../packages/web/src/styles.css';
import './demo.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: false } },
});
const root = createRoot(document.getElementById('root')!);
function render() {
  const view = document.location.hash.match(/^#\/(letters|settings|rules|feeds)/)?.[1] ?? 'library';
  root.render(
    <>
      <IconSprite />
      <QueryClientProvider client={queryClient}>
        <App key={view} />
      </QueryClientProvider>
    </>,
  );
}
window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);
render();
