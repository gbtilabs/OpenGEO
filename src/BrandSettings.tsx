import { useEffect, useState } from 'react';
import { Save, Trash2, Download } from 'lucide-react';
import type { Project } from '../server/contracts';
import { api } from './api';
import { Dialog } from './ui/Dialog';
import { FormFeedback, useFormFeedback } from './FormFeedback';
import { SiteIcon } from './SiteIcon';
import { Section } from './ui/Primitives';
import { LanguageSelect } from './LanguageSelect';
import type { EditState } from './useCloseProtection';

export function BrandSettings({ project, refresh, onEditState }: { project: Project; refresh: () => Promise<void>; onEditState: (state: EditState) => void }) {
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onEditState({ dirty, busy }); return () => onEditState({ dirty: false, busy: false }); }, [dirty, busy, onEditState]);
  const [deleting, setDeleting] = useState(false), [confirmation, setConfirmation] = useState('');
  const feedback = useFormFeedback();
  async function perform(action: () => Promise<void>) {
    setBusy(true); feedback.setError(''); setSaved(false);
    try { await action(); await refresh(); } catch (error) { feedback.setError(error); }
    finally { setBusy(false); }
  }
  return <Section className="brand-settings" title="Brand details" description="Help AI checks recognize your brand and create relevant suggestions." action={<div className="brand-domain"><SiteIcon projectId={project.id} domain={project.domain} size={24} /><span>{project.domain}</span></div>}>
    <form className="brand-form" onChange={() => { setDirty(true); setSaved(false); }} onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const lines = (name: string) => String(form.get(name) ?? '').split('\n').map(value => value.trim()).filter(Boolean);
      void perform(async () => {
        await api('/projects/' + project.id, { brand: form.get('brand'), aliases: lines('aliases'), locale: form.get('locale'), competitors: lines('competitors'), knowledge: form.get('knowledge') }, 'PATCH');
        setDirty(false); setSaved(true);
      });
    }}>
      <fieldset className="form-fields" disabled={busy}><div className="form-grid">
        <label>Brand name<input name="brand" required maxLength={100} defaultValue={project.brand} {...feedback.field('brand')} /></label>
        <label>Language and region<LanguageSelect name="locale" label="Language and region" defaultValue={project.locale} onChange={() => { setDirty(true); setSaved(false); }} {...feedback.field('locale')} /><small>The language and region used for your AI checks.</small></label>
        <label>Other names your customers use<textarea name="aliases" rows={3} defaultValue={project.aliases.join('\n')} placeholder="One brand name per line" {...feedback.field('aliases')} /></label>
        <label>Competitor websites<textarea name="competitors" rows={3} defaultValue={project.competitors.join('\n')} placeholder="One website per line" {...feedback.field('competitors')} /></label>
      </div>
      <label>What should we know about your business?<textarea name="knowledge" rows={4} maxLength={50000} defaultValue={project.knowledge} placeholder="Your products, customers, expertise and important facts." {...feedback.field('knowledge')} /></label>
      </fieldset>
      {!deleting && <FormFeedback feedback={feedback} />}
      {saved && <p role="status" className="save-notice">Brand details saved.</p>}
      <button className="primary" disabled={busy}><Save size={16} />{busy ? 'Saving...' : 'Save brand details'}</button>
    </form>
    <div className="brand-delete-row"><div><h3>Remove this brand</h3><p>Delete its prompts, scans, results and drafts from this device. Your other brands and connections stay.</p></div><button className="secondary danger-text" disabled={busy} onClick={() => { feedback.setError(''); setConfirmation(''); setDeleting(true); }}><Trash2 size={16} />Delete brand</button></div>
    {deleting && <Dialog title={'Delete ' + project.brand + '?'} dismissible={!busy} close={() => setDeleting(false)}>
      <p>This permanently removes this brand and its saved work from this device. It does not cancel any external provider subscription or delete hosted data.</p>
      <a className="secondary" href={'/api/projects/' + project.id + '/export'}><Download size={16} />Download a backup first</a>
      <form onSubmit={event => { event.preventDefault(); void perform(async () => { await api('/projects/' + project.id, { confirmation }, 'DELETE'); setDeleting(false); }); }}>
        <label>Type {project.domain} to confirm<input autoFocus value={confirmation} onChange={event => setConfirmation(event.target.value)} autoCapitalize="none" spellCheck={false} /></label>
        <FormFeedback feedback={feedback} />
        <div className="button-row"><button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(false)}>Keep brand</button><button className="primary danger-button" disabled={busy || confirmation !== project.domain}><Trash2 size={16} />{busy ? 'Deleting...' : 'Delete permanently'}</button></div>
      </form>
    </Dialog>}
  </Section>;
}
