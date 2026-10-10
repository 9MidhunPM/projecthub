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
    let reads = 0;
    let mutations = 0;
    globalThis.fetch = async url => {
      if (String(url).endsWith('/auth/me')) return Response.json(++reads === 1 ? student : {...student, id: 'student-2', name: 'Second student'});
      if (String(url).endsWith('/like')) return ++mutations === 1 ? first.promise : second.promise;
      if (String(url).endsWith('/view')) return Response.json({views: 2});
      return Response.json(project);
    };
    const view = renderApp(<Subject detail={detail}/>);
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
    fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    fireEvent.click(view.getByRole('button', {name: 'Switch session'}));
    await waitFor(() => assert.ok(view.getByRole('link', {name: 'Your profile, Second student'})));
    await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
    fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
    await act(async () => first.resolve(Response.json({message: 'Old request failed'}, {status: 503})));
    assert.ok(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled'));
    assert.ok(view.queryByText('Old request failed') === null);
    await act(async () => second.resolve(Response.json({likes: 1, liked: true, bookmarked: false})));
    assert.equal(view.getByRole('button', {name: `Unlike ${project.title}, 1 likes`}).hasAttribute('disabled'), false);
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
