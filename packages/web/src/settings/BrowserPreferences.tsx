import { Select } from '../components/patterns';
import { Checkbox } from '../components/controls';
import { ModalSheet } from '../components/Sheet';
import { useBrowserPreferences } from '../hooks/useBrowserPreferences';

export function PreferenceFeedback({
  preferences,
  name = 'Preferences result',
  visible = false,
}: {
  preferences: ReturnType<typeof useBrowserPreferences>;
  name?: string;
  visible?: boolean;
}) {
  return (
    <>
      <section
        aria-label={name}
        aria-live="polite"
        aria-atomic="true"
        className={visible && preferences.message ? 'text-sm text-soft' : 'sr-only'}
      >
        {preferences.message}
      </section>
      {preferences.error && (
        <p role="alert" className="text-sm text-danger">
          {preferences.error}
        </p>
      )}
      {preferences.readError && (
        <div role="alert" className="text-sm text-danger">
          <p>{preferences.readError}</p>
          <button
            type="button"
            className="brew-button brew-button--secondary brew-button--sm"
            onClick={preferences.refresh}
          >
            Retry browser preferences
          </button>
        </div>
      )}
    </>
  );
}
export function GeneralPreferences() {
  const preferences = useBrowserPreferences();
  const { values, save } = preferences;
  return (
    <>
      <Select
        label="Theme"
        value={values.theme}
        onChange={(e) => save('theme', e.target.value, 'Theme')}
        data-brew-action="set-theme"
      >
        <option value="system">System theme</option>
        <option value="light">Light theme</option>
        <option value="dark">Dark theme</option>
      </Select>
      <Select
        label="Image privacy"
        value={values.images}
        onChange={(e) => save('images', e.target.value, 'Image privacy')}
        data-brew-action="set-image-privacy"
      >
        <option value="proxy">Private images</option>
        <option value="direct">Load images directly</option>
      </Select>
      <Select
        label="Default landing page"
        value={values.landing}
        onChange={(e) => save('landing', e.target.value, 'Default landing page')}
        data-brew-action="set-landing"
      >
        <option value="brew">Start at Brew</option>
        <option value="reader">Start at Reader</option>
      </Select>
      <PreferenceFeedback preferences={preferences} visible />
    </>
  );
}
export function ReadingPreferences() {
  const preferences = useBrowserPreferences();
  const { values, save } = preferences;
  return (
    <>
      <Select
        label="Open articles"
        value={values.openMode}
        onChange={(e) => save('openMode', e.target.value, 'Article opening mode')}
        data-brew-action="set-open-mode"
      >
        <option value="overlay">Open in overlay</option>
        <option value="pane">Open in pane</option>
      </Select>
      <Checkbox
        label="Read on scroll"
        checked={values.readOnScroll === 'true'}
        onChange={(e) => save('readOnScroll', String(e.target.checked), 'Read on scroll')}
        data-brew-action="set-read-on-scroll"
      />
      <p className="text-sm text-soft">
        Read on scroll marks articles read as they leave the Reader list.
      </p>
      <Select
        label="Reader font"
        value={values.font}
        onChange={(e) => save('font', e.target.value, 'Reader font')}
        data-brew-action="set-reader-font"
      >
        <option value="serif">Serif</option>
        <option value="sans">Sans</option>
      </Select>
      <Select
        label="Reader width"
        value={values.width}
        onChange={(e) => save('width', e.target.value, 'Reader width')}
        data-brew-action="set-reader-width"
      >
        <option value="narrow">Narrow</option>
        <option value="wide">Wide</option>
      </Select>
      <Select
        label="Reader line height"
        value={values.lineHeight}
        onChange={(e) => save('lineHeight', e.target.value, 'Reader line height')}
        data-brew-action="set-reader-line-height"
      >
        <option value="relaxed">Relaxed</option>
        <option value="compact">Compact</option>
      </Select>
      <PreferenceFeedback preferences={preferences} visible />
    </>
  );
}
export function BrowserPreferencesDialog({
  topic,
  close,
}: {
  topic: 'general' | 'reading';
  close: () => void;
}) {
  return (
    <ModalSheet
      open
      title={topic === 'general' ? 'General settings' : 'Reading settings'}
      onClose={close}
      footer={
        <button
          type="button"
          className="brew-button brew-button--primary brew-button--md"
          onClick={close}
        >
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-soft">Changes save immediately in this browser.</p>
        {topic === 'general' ? <GeneralPreferences /> : <ReadingPreferences />}
      </div>
    </ModalSheet>
  );
}
