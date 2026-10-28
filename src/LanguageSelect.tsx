import { Select } from './Select';

const languages = [
  { value: 'en-US', label: 'English (United States)' }, { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'fr-FR', label: 'French (France)' }, { value: 'fr-MA', label: 'French (Morocco)' },
  { value: 'es-ES', label: 'Spanish (Spain)' }, { value: 'de-DE', label: 'German (Germany)' },
  { value: 'ar-MA', label: 'Arabic (Morocco)' }, { value: 'pt-BR', label: 'Portuguese (Brazil)' },
];

/** Imported projects may use other valid locales; opening a form must preserve them. */
export function LanguageSelect(props: Omit<Parameters<typeof Select>[0], 'options'>) {
  const current = props.value ?? props.defaultValue;
  const options = current && !languages.some(item => item.value === current)
    ? [...languages, { value: current, label: current }] : languages;
  return <Select {...props} options={options} />;
}
