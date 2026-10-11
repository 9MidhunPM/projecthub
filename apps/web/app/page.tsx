'use client';

import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {Search, SlidersHorizontal, ChevronLeft, ChevronRight, ArrowRight, X} from 'lucide-react';
import {api, departments, isAbortError, projectTypes, Listing} from '@/lib/api';
import {defaultGalleryQuery, galleryHref, GalleryQuery, hasGalleryFilters, parseGalleryQuery, serializeGalleryQuery} from '@/lib/gallery-query';
import {ProjectCard} from '@/components/project-card';
import {ErrorMessage} from '@/components/shell';

export default function Explore() {
  const [query, setQuery] = useState<GalleryQuery>(defaultGalleryQuery);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const filterToggle = useRef<HTMLButtonElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterPage = useRef(false);
  const search = serializeGalleryQuery(query);
  const hasFilters = hasGalleryFilters(query);
  const filterCount = [query.q.trim(), query.department, query.semester, query.type, query.tech.trim()].filter(Boolean).length;

  useEffect(() => {
    const restore = () => {
      // A popstate can reach this listener before Next unmounts the gallery.
      // Never canonicalize another route into an Explore URL.
      if (window.location.pathname !== '/') { setReady(false); return; }
      setReady(true);
      const restored = parseGalleryQuery(window.location.search);
      setQuery(restored);
      window.history.replaceState(window.history.state, '', galleryHref(restored));
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = window.setTimeout(async () => {
      if (window.location.pathname !== '/') return;
      const href = search ? `/?${search}` : '/';
      if (`${window.location.pathname}${window.location.search}` !== href) {
        window.history.pushState(window.history.state, '', href);
      }
      try {
        const params = new URLSearchParams(search);
        params.set('limit', '6');
        const result = await api<Listing>(`/projects?${params}`, {signal: controller.signal});
        if (controller.signal.aborted || window.location.pathname !== '/') return;
        const lastPage = Math.max(1, result.pages);
        if (query.page > lastPage) {
          const corrected = {...query, page: lastPage};
          window.history.replaceState(window.history.state, '', galleryHref(corrected));
          setQuery(corrected);
          return;
        }
        setData(result);
        if (focusAfterPage.current) {
          resultsHeading.current?.focus({preventScroll: true});
          resultsHeading.current?.scrollIntoView({block: 'start', behavior: 'auto'});
          focusAfterPage.current = false;
        }
      } catch (failure) {
        if (!controller.signal.aborted && window.location.pathname === '/' && !isAbortError(failure)) setError((failure as Error).message);
      } finally {
        if (!controller.signal.aborted && window.location.pathname === '/') setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // The serialized string is the canonical request identity; whitespace-only
    // input changes must not create duplicate history entries or API requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, ready, retry]);

  function update(values: Partial<GalleryQuery>) {
    setQuery(previous => ({...previous, ...values, page: 1}));
  }

  function changePage(page: number) {
    focusAfterPage.current = true;
    setQuery(previous => ({...previous, page}));
  }

  function clear() {
    setQuery(previous => ({...defaultGalleryQuery, sort: previous.sort}));
  }

  const activeFilters = [
    {key: 'q' as const, label: `Search: ${query.q.trim()}`, value: query.q.trim()},
    {key: 'department' as const, label: query.department, value: query.department},
    {key: 'semester' as const, label: `Semester ${query.semester}`, value: query.semester},
    {key: 'type' as const, label: query.type, value: query.type},
    {key: 'tech' as const, label: `Technology: ${query.tech.trim()}`, value: query.tech.trim()},
  ].filter(filter => filter.value);

  return <div className="page-container explore-page">
    <section className="hero">
      <div><h1>Big ideas. <span>Built here.</span></h1><p>Discover what students are building. Share what comes next.</p></div>
      <span className="hero-note">A home for student work.<ArrowRight size={18} aria-hidden="true"/></span>
    </section>
    <div className="search-toolbar">
      <div className="search-input"><Search size={20} aria-hidden="true"/><input type="search" aria-label="Search projects" value={query.q} maxLength={200} onChange={event => update({q: event.target.value})} placeholder="Search projects or ideas"/></div>
      <button ref={filterToggle} className="button filter-toggle" aria-expanded={filtersOpen} aria-controls="project-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={17} aria-hidden="true"/>Filters{filterCount > 0 ? ` (${filterCount})` : ''}</button>
      <label className="sort-label">Sort<select aria-label="Sort projects" value={query.sort} onChange={event => update({sort: event.target.value as GalleryQuery['sort']})}><option value="recent">Newest</option><option value="popular">Most liked</option></select></label>
    </div>
    <div className="gallery-layout">
      <aside id="project-filters" className={`filter-rail ${filtersOpen ? 'filters-open' : ''}`} aria-label="Project filters" onKeyDown={event => {
        if (event.key === 'Escape' && filtersOpen) { setFiltersOpen(false); filterToggle.current?.focus(); }
      }}>
        <div className="filter-heading"><SlidersHorizontal size={16} aria-hidden="true"/>Find your inspiration</div>
        <label>Department<select value={query.department} onChange={event => update({department: event.target.value})}><option value="">All departments</option>{query.department && !departments.includes(query.department) && <option>{query.department}</option>}{departments.map(department => <option key={department}>{department}</option>)}</select></label>
        <label>Semester<select value={query.semester} onChange={event => update({semester: event.target.value})}><option value="">All semesters</option>{Array.from({length: 12}, (_, index) => <option value={index + 1} key={index}>Semester {index + 1}</option>)}</select></label>
        <label>Project type<select value={query.type} onChange={event => update({type: event.target.value})}><option value="">All project types</option>{query.type && !projectTypes.includes(query.type) && <option>{query.type}</option>}{projectTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Technology<input value={query.tech} maxLength={40} onChange={event => update({tech: event.target.value})} placeholder="e.g. React" aria-describedby="technology-filter-hint"/><small id="technology-filter-hint">Enter one technology to match.</small></label>
        <div className="rail-note">Every great project<br/>starts with a little curiosity.</div>
      </aside>
      <section className="gallery-results" aria-label="Project results" aria-busy={loading}>
        <div className="section-title"><h2 ref={resultsHeading} tabIndex={-1}>Explore projects</h2><span role="status">{loading ? 'Finding projects…' : error ? 'Results unavailable' : `${data?.total ?? 0} ${data?.total === 1 ? 'project' : 'projects'}`}</span></div>
        {hasFilters && <div className="active-filters" aria-label="Active filters">
          {activeFilters.map(filter => <button className="filter-chip" key={filter.key} onClick={() => update({[filter.key]: ''})} aria-label={`Remove ${filter.label} filter`}><span>{filter.label}</span><X size={13} aria-hidden="true"/></button>)}
          <button className="text-link" onClick={clear}>Clear filters</button>
        </div>}
        <ErrorMessage message={error}/>
        {error && <div className="results-recovery"><button className="button" onClick={() => setRetry(value => value + 1)}>Try again</button>{data && <p className="muted">Showing the previous results until we can refresh them.</p>}</div>}
        {loading && !data ? <div className="project-grid" aria-hidden="true">{Array.from({length: 6}, (_, index) => <div key={index} className="skeleton-card"><div/><span/><span/></div>)}</div> : data?.items.length ? <>
          <div className={`project-grid ${loading ? 'refreshing' : ''}`}>{data.items.map(project => <ProjectCard project={project} key={`${project.id}-${project.likes}-${project.bookmarked}`}/>)}</div>
          <nav className="pagination" aria-label="Project pages">
            <button className="icon-button" disabled={query.page <= 1 || loading || Boolean(error)} onClick={() => changePage(query.page - 1)} aria-label="Previous page"><ChevronLeft size={18} aria-hidden="true"/></button>
            <span>Page {data.page} of {Math.max(1, data.pages)}</span>
            <button className="icon-button" disabled={query.page >= data.pages || loading || Boolean(error)} onClick={() => changePage(query.page + 1)} aria-label="Next page"><ChevronRight size={18} aria-hidden="true"/></button>
          </nav>
        </> : !error && !loading && <div className="empty"><Search size={34} aria-hidden="true"/><h3>{hasFilters ? 'No matching projects' : 'The next great project could be yours.'}</h3><p>{hasFilters ? 'Try a different search or remove a filter above.' : 'No projects have been published yet. Share your work for faculty review and help this community get started.'}</p>{!hasFilters && <Link className="button primary" href="/projects/new">Share the first project</Link>}</div>}
      </section>
    </div>
  </div>;
}
