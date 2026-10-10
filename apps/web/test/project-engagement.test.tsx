import './dom-setup';
import assert from 'node:assert/strict';
import {useState} from 'react';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {ProjectCard} from '../components/project-card';
import {ProjectDetail} from '../components/project-detail';
import {useApp} from '../components/shell';
import {deferred, project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

function Subject({detail}: {detail: boolean}) {
  const {refresh} = useApp();
  const [id, setId] = useState(project.id);
  return <><button onClick={() => void refresh()}>Switch session</button><button onClick={() => setId('project-2')}>Switch project</button>{detail ? <ProjectDetail id={id}/> : <ProjectCard project={{...project, id}}/>}</>;
}

for (const detail of [false, true]) {
  const name = detail ? 'detail' : 'card';
  for (const outcome of ['success', 'error'] as const) test(`${name} ignores late engagement ${outcome} after a session switch`, async () => {
    const response = deferred<Response>();
    let reads = 0;
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/auth/me')) return Response.json(++reads === 1 ? student : {...student, id: 'student-2', name: 'Second student'});
      if (String(url).endsWith('/like')) { signal = options?.signal; return response.promise; }
      if (String(url).endsWith('/view')) return Response.json({views: 2});
      return Response.json(project);
    };
    const view = renderApp(<Subject detail={detail}/>);
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
    fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    fireEvent.click(view.getByRole('button', {name: 'Switch session'}));
    await waitFor(() => assert.ok(view.getByRole('link', {name: 'Your profile, Second student'})));
    await act(async () => response.resolve(outcome === 'success' ? Response.json({likes: 1, liked: true, bookmarked: false}) : Response.json({message: 'Old account error'}, {status: 503})));
    assert.ok(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    assert.ok(view.queryByText('Old account error') === null);
    assert.equal(signal?.aborted, true);
  });

  test(`${name} cancels project replacement and unmount without applying stale engagement`, async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: (AbortSignal | null | undefined)[] = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/auth/me')) return Response.json(student);
      if (String(url).endsWith('/like')) { signals.push(options?.signal); return signals.length === 1 ? first.promise : second.promise; }
      if (String(url).endsWith('/view')) return Response.json({views: 2});
      return Response.json({...project, id: String(url).includes('project-2') ? 'project-2' : project.id});
    };
    const view = renderApp(<Subject detail={detail}/>);
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
    fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    fireEvent.click(view.getByRole('button', {name: 'Switch project'}));
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
    assert.equal(signals[0]?.aborted, true);
    await act(async () => first.resolve(Response.json({likes: 1, liked: true, bookmarked: false})));
    assert.ok(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    view.unmount();
    assert.equal(signals[1]?.aborted, true);
    await act(async () => second.resolve(Response.json({message: 'Unmounted error'}, {status: 503})));
    assert.ok(document.body.textContent?.includes('Unmounted error') === false);
  });

  test(`${name} sends one engagement request for repeated clicks and reports current failures`, async () => {
    const response = deferred<Response>();
    let mutations = 0;
    globalThis.fetch = async url => {
      if (String(url).endsWith('/auth/me')) return Response.json(student);
      if (String(url).endsWith('/bookmark')) { mutations += 1; return response.promise; }
      if (String(url).endsWith('/view')) return Response.json({views: 2});
      return Response.json(project);
    };
    const view = renderApp(<Subject detail={detail}/>);
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Save ${project.title}`}).hasAttribute('disabled')));
    const action = view.getByRole('button', {name: `Save ${project.title}`});
    fireEvent.click(action); fireEvent.click(action);
    assert.equal(mutations, 1);
    await act(async () => response.resolve(Response.json({message: 'Please try saving again'}, {status: 503})));
    assert.ok(view.getByText('Please try saving again'));
    assert.equal(view.getByRole('button', {name: `Save ${project.title}`}).hasAttribute('disabled'), false);
    await act(async () => fireEvent.click(view.getByRole('button', {name: `Save ${project.title}`})));
    assert.equal(mutations, 2, 'current failures allow an explicit retry');
  });
}

for (const detail of [false, true]) {
  const name = detail ? 'detail' : 'card';
  test(`${name} keeps a newer request busy when an older viewer response finishes`, async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const nextSession = deferred<Response>();
    const nextProject = deferred<Response>();
    const mutations: {url: string; method: string | undefined; signal: AbortSignal | null | undefined}[] = [];
    let sessionReads = 0;
    let projectReads = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/auth/me')) return ++sessionReads === 1 ? Response.json(student) : nextSession.promise;
      if (String(url).endsWith('/like')) {
        mutations.push({url: String(url), method: options?.method, signal: options?.signal});
        return mutations.length === 1 ? first.promise : second.promise;
      }
      if (String(url).endsWith('/view')) return Response.json({views: 2});
      projectReads += 1;
      return projectReads === 1 ? Response.json(project) : nextProject.promise;
    };
    const view = renderApp(<Subject detail={detail}/>);
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
    fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].method, 'PUT');

    fireEvent.click(view.getByRole('button', {name: 'Switch session'}));
    await waitFor(() => assert.equal(sessionReads, 2));
    assert.equal(mutations[0].signal?.aborted, true);
    assert.equal(mutations.length, 1, 'the replacement viewer has not finished loading');
    await act(async () => nextSession.resolve(Response.json({...student, id: 'student-2', name: 'Second student'})));
    if (detail) {
      await waitFor(() => assert.equal(projectReads, 2));
      assert.ok(view.getByText('Loading project…'));
      assert.equal(mutations.length, 1, 'the replacement project snapshot is still pending');
      await act(async () => nextProject.resolve(Response.json({...project, title: 'Second viewer snapshot'})));
    }
    // Header identity alone is not proof that Detail's viewer-specific read has
    // completed. A distinct response title identifies the settled new snapshot.
    const title = detail ? 'Second viewer snapshot' : project.title;
    const action = view.getByRole('button', {name: `Like ${title}, 0 likes`});
    assert.equal(action.hasAttribute('disabled'), false);
    fireEvent.click(action);
    assert.equal(mutations.length, 2, 'the newer request must actually be in flight');
    assert.equal(mutations[1].method, 'PUT');
    assert.equal(mutations[1].signal?.aborted, false);

    await act(async () => first.resolve(Response.json({message: 'Old request failed'}, {status: 503})));
    assert.ok(view.getByRole('button', {name: `Like ${title}, 0 likes`}).hasAttribute('disabled'));
    assert.equal(mutations[1].signal?.aborted, false, 'old completion cannot cancel the newer request');
    assert.ok(view.queryByText('Old request failed') === null);
    fireEvent.click(action);
    assert.equal(mutations.length, 2, 'old completion cannot unlock duplicate clicks');
    await act(async () => second.resolve(Response.json({likes: 1, liked: true, bookmarked: false})));
    assert.equal(view.getByRole('button', {name: `Unlike ${title}, 1 likes`}).hasAttribute('disabled'), false);
    assert.equal(projectReads, detail ? 2 : 0);
  });

  test(`${name} blocks engagement while the viewer is being refreshed`, async () => {
    const session = deferred<Response>();
    let reads = 0;
    let mutations = 0;
    globalThis.fetch = async url => {
      if (String(url).endsWith('/auth/me')) return ++reads === 1 ? Response.json(student) : session.promise;
      if (String(url).endsWith('/like')) { mutations += 1; return Response.json({likes: 1, liked: true, bookmarked: false}); }
      if (String(url).endsWith('/view')) return Response.json({views: 2});
      return Response.json(project);
    };
    const view = renderApp(<Subject detail={detail}/>);
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
    fireEvent.click(view.getByRole('button', {name: 'Switch session'}));
    fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    assert.equal(mutations, 0);
    await act(async () => session.resolve(Response.json(student)));
  });

  test(`${name} retains its anonymous return destination without sending engagement`, async () => {
    window.history.replaceState({}, '', detail ? `/projects/${project.id}` : '/?q=campus');
    let mutations = 0;
    globalThis.fetch = async url => {
      if (String(url).endsWith('/auth/me')) return Response.json({message: 'Unauthorized'}, {status: 401});
      if (String(url).endsWith('/like')) mutations += 1;
      if (String(url).endsWith('/view')) return Response.json({views: 2});
      return Response.json(project);
    };
    const view = renderApp(<Subject detail={detail}/>, detail ? `/projects/${project.id}` : '/');
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
    fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    assert.equal(mutations, 0);
    assert.deepEqual(view.navigation, [{method: 'push', href: `/login?next=${encodeURIComponent(detail ? `/projects/${project.id}` : '/?q=campus')}`}]);
  });
}
