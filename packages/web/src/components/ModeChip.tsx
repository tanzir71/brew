import { useCapabilities } from '../hooks/useCapabilities';
import { runAssets } from './figmaAssets';
import { runtimeNames } from './runtimeNames';

export function ModeChip() {
  const query = useCapabilities();
  const label = query.data
    ? runtimeNames[query.data.mode].short
    : query.isError
      ? 'Unavailable'
      : 'Checking…';
  return (
    <a className="brew-mode-chip" href="/settings/runs" aria-label={`${label} · Where Brew runs`}>
      <img src={runAssets.mode} alt="" />
      {label}
    </a>
  );
}
