import { runAssets } from '../components/figmaAssets';
import { agentPageHref } from '../agentLocation';
export function SettingsNav({
  current = 'runs',
  preferenceTopic,
}: {
  current?: 'runs' | 'agents' | 'apps';
  preferenceTopic?: 'general' | 'reading';
}) {
  const runsHref = (hash = '') =>
    agentPageHref(current === 'runs' && hash ? hash : `/settings/runs${hash}`);
  return (
    <nav aria-label="Settings" className="runs-settings-nav">
      <h2>Settings</h2>
      <a
        href={runsHref('#preferences-general')}
        aria-current={preferenceTopic === 'general' ? 'page' : undefined}
      >
        <img src={runAssets.general} alt="" />
        General
      </a>
      <a
        href={runsHref('#preferences-reading')}
        aria-current={preferenceTopic === 'reading' ? 'page' : undefined}
      >
        <img src={runAssets.reading} alt="" />
        Reading
      </a>
      <a
        href={runsHref()}
        aria-current={!preferenceTopic && current === 'runs' ? 'page' : undefined}
      >
        <img src={current === 'agents' ? '/figma/agents/342e1.svg' : runAssets.runs} alt="" />
        Where Brew runs
      </a>
      <a href={runsHref('#setup-newsletters')}>
        <img src={runAssets.inbox} alt="" />
        Newsletters
      </a>
      <a
        href={agentPageHref('/settings/agents')}
        aria-current={current === 'agents' ? 'page' : undefined}
      >
        <img src={current === 'agents' ? '/figma/agents/1d102.svg' : runAssets.agent} alt="" />
        Agent access
      </a>
      <a
        href={agentPageHref('/settings/apps')}
        aria-current={current === 'apps' ? 'page' : undefined}
      >
        <img src={runAssets.apps} alt="" />
        Apps &amp; sync
      </a>
      <a href={runsHref('#setup-data')}>
        <img src={runAssets.backup} alt="" />
        Data &amp; backup
      </a>
    </nav>
  );
}
