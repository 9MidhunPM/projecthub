'use client';

import {useEffect, useRef, useState} from 'react';
import type {Dispatch, SetStateAction} from 'react';
import {ArrowLeft, ArrowRight, Upload, X} from 'lucide-react';
import {api, isAbortError} from '@/lib/api';
import {MAX_SCREENSHOTS, moveScreenshot, validateScreenshots} from '@/lib/screenshots';
import {ErrorMessage} from './shell';

type Props = {
  screenshots: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  onUploadingChange: (uploading: boolean) => void;
  disabled: boolean;
};

export function ScreenshotEditor({screenshots, onChange, onUploadingChange, disabled}: Props) {
  const [progress, setProgress] = useState<{completed: number; total: number; name: string} | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [remaining, setRemaining] = useState<File[]>([]);
  const active = useRef<AbortController | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const uploading = progress !== null;

  useEffect(() => () => { active.current?.abort(); }, []);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);

  async function upload(files: File[]) {
    if (!files.length || active.current || disabled) return;
    setError('');
    setNotice('');
    setRemaining([]);
    const validation = validateScreenshots(files, screenshots.length);
    if (validation) { setError(validation); return; }
    const controller = new AbortController();
    active.current = controller;
    onUploadingChange(true);
    setProgress({completed: 0, total: files.length, name: files[0].name});
    let completed = 0;
    try {
      for (const file of files) {
        setProgress({completed, total: files.length, name: file.name});
        const body = new FormData();
        body.append('file', file);
        const result = await api<{url: string}>('/uploads', {method: 'POST', body, signal: controller.signal});
        if (controller.signal.aborted) return;
        onChange(previous => [...previous, result.url]);
        completed += 1;
      }
      setNotice(`${completed} ${completed === 1 ? 'screenshot added' : 'screenshots added'}. Save your project to keep these changes.`);
    } catch (failure) {
      if (!controller.signal.aborted && !isAbortError(failure)) {
        setRemaining(files.slice(completed));
        setError(`${completed ? `${completed} of ${files.length} screenshots added. ` : ''}${files[completed].name}: ${(failure as Error).message}`);
      }
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setProgress(null);
        onUploadingChange(false);
      }
    }
  }

  function move(from: number, to: number) {
    onChange(previous => moveScreenshot(previous, from, to));
    setNotice(`Screenshot ${from + 1} moved to position ${to + 1}.${to === 0 ? ' It is now the cover image.' : ''} Save to keep this order.`);
  }

  return <section className="form-panel screenshot-editor" aria-labelledby="screenshots-title" aria-busy={uploading}>
    <h2 id="screenshots-title">Show your work</h2>
    <p>The first screenshot is your cover image. Add up to 8 screenshots and put them in the order you want visitors to see.</p>
    <label className={`upload-area ${disabled || uploading || screenshots.length >= MAX_SCREENSHOTS ? 'upload-disabled' : ''}`}>
      <Upload size={26} aria-hidden="true"/><strong>{uploading ? 'Uploading screenshots…' : screenshots.length >= MAX_SCREENSHOTS ? 'All 8 screenshot slots filled' : 'Choose screenshots'}</strong>
      <span id="screenshots-hint">PNG, JPEG or WebP · up to 5 MB each · {screenshots.length}/8 added</span>
      <input type="file" aria-label="Choose screenshots" aria-describedby="screenshots-hint" accept="image/png,image/jpeg,image/webp" multiple onChange={event => { void upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} disabled={disabled || uploading || screenshots.length >= MAX_SCREENSHOTS}/>
    </label>
    {progress && <div className="upload-progress" role="status"><progress max={progress.total} value={progress.completed} aria-label="Screenshot upload progress"/><span>Uploading {progress.completed + 1} of {progress.total}: {progress.name}</span></div>}
    <div ref={errorSummary} tabIndex={-1} className="form-error-summary"><ErrorMessage message={error}/></div>
    {remaining.length > 0 && <button type="button" className="button" disabled={disabled || uploading} onClick={() => void upload(remaining)}>Retry {remaining.length === 1 ? 'remaining screenshot' : `${remaining.length} remaining screenshots`}</button>}
    <p className="upload-notice" role="status">{notice}</p>
    <div className="upload-previews">
      {screenshots.map((src, index) => <figure key={`${src}-${index}`}>
        <img src={src} alt={`Project screenshot ${index + 1}`}/>
        <figcaption>{index === 0 ? 'Cover image' : `Screenshot ${index + 1}`}</figcaption>
        <div className="screenshot-controls">
          <button type="button" className="icon-button" disabled={disabled || uploading || index === 0} aria-label={`Move screenshot ${index + 1} earlier`} onClick={() => move(index, index - 1)}><ArrowLeft size={15} aria-hidden="true"/></button>
          <button type="button" className="icon-button" disabled={disabled || uploading || index === screenshots.length - 1} aria-label={`Move screenshot ${index + 1} later`} onClick={() => move(index, index + 1)}><ArrowRight size={15} aria-hidden="true"/></button>
          <button type="button" className="icon-button" disabled={disabled || uploading} aria-label={`Remove screenshot ${index + 1}`} onClick={() => { onChange(previous => previous.filter((_, item) => item !== index)); setNotice(`Screenshot ${index + 1} removed. Save to keep this change.`); }}><X size={15} aria-hidden="true"/></button>
        </div>
      </figure>)}
    </div>
  </section>;
}
