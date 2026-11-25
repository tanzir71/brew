import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCapabilities } from '../src/hooks/useCapabilities';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export function Probe({ name }: { name: string }) {
  const query = useCapabilities();
  return (
    <section aria-label={name} data-capabilities-available={query.data !== undefined}>
      {query.isError ? (
        <p role="alert">{query.error.message}</p>
      ) : (
        <output role="status">
          {query.isPending ? 'Loading capabilities' : JSON.stringify(query.data)}
        </output>
      )}
      <button onClick={() => void query.refetch()}>Reload capabilities</button>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <Probe name="First consumer" />
    <Probe name="Second consumer" />
  </QueryClientProvider>,
);
