import assert from 'node:assert/strict';
import test from 'node:test';
import { ObservableMap, ObservableMapDisposedError } from '../dist/esm/index.js';

test('map methods preserve standard storage behavior and notify effective changes', () => {
  const map = new ObservableMap([['a', 1]]);
  const events = [];
  map.subscribe((event) => events.push(event));
  assert.equal(map.set('a', 1), map);
  map.set('a', 2).set('b', 3);
  assert.equal(map.delete('b'), true);
  assert.equal(map.delete('missing'), false);
  assert.deepEqual([...map], [['a', 2]]);
  assert.deepEqual(
    events.map((event) => event.type),
    ['set', 'set', 'delete'],
  );
});

test('notification objects and batch snapshots are immutable', () => {
  const map = new ObservableMap();
  let observed;
  map.subscribe((event) => {
    observed = event;
  });
  map.batch((store) => store.set('key', 'value'));
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.changes), true);
  assert.equal(Object.isFrozen(observed.changes[0]), true);
});

test('key subscriptions and abort signal filter updates and clear entries', () => {
  const map = new ObservableMap();
  const seen = [];
  const controller = new AbortController();
  map.subscribe((event) => seen.push(event), { key: 'wanted', signal: controller.signal });
  map.set('other', 1);
  map.set('wanted', 2);
  map.set('another', 3);
  map.clear();
  assert.deepEqual(
    seen.map((event) => event.type),
    ['set', 'clear'],
  );
  assert.deepEqual(seen[1].entries, [['wanted', 2]]);
  controller.abort();
  map.set('wanted', 4);
  assert.equal(seen.length, 2);
});

test('batches are atomic notifications and nested operations retain order', () => {
  const map = new ObservableMap();
  const events = [];
  map.subscribe((event) => events.push(event));
  map.batch((store) => {
    store.set('a', 1);
    store.batch((nested) => {
      nested.set('b', 2);
      nested.delete('a');
    });
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'batch');
  assert.deepEqual(
    events[0].changes.map((change) => change.type),
    ['set', 'set', 'delete'],
  );
});

test('batch flushes committed changes even when callback throws', () => {
  const map = new ObservableMap();
  const events = [];
  map.subscribe((event) => events.push(event));
  assert.throws(
    () =>
      map.batch((store) => {
        store.set('x', 1);
        throw new Error('callback failure');
      }),
    /callback failure/,
  );
  assert.equal(map.get('x'), 1);
  assert.equal(events[0].type, 'batch');
});

test('batch preserves callback and listener errors together', () => {
  const map = new ObservableMap();
  map.subscribe(() => {
    throw new Error('listener failure');
  });
  assert.throws(
    () =>
      map.batch((store) => {
        store.set('x', 1);
        throw new Error('callback failure');
      }),
    (error) => error instanceof AggregateError && error.errors.length === 2,
  );
  assert.equal(map.get('x'), 1);
});

test('reentrant changes queue in order and listener failures aggregate after dispatch', () => {
  const map = new ObservableMap();
  const seen = [];
  map.subscribe((event) => {
    seen.push(`first:${event.type === 'set' ? event.key : event.type}`);
    if (event.type === 'set' && event.key === 'a') map.set('b', 2);
  });
  map.subscribe((event) => {
    seen.push(`second:${event.type === 'set' ? event.key : event.type}`);
    if (event.type === 'set' && event.key === 'a') throw new Error('listener failure');
  });
  assert.throws(() => map.set('a', 1), AggregateError);
  assert.deepEqual(seen, ['first:a', 'second:a', 'first:b', 'second:b']);
  assert.equal(map.get('b'), 2);
});

test('dispose is idempotent, detaches listeners, and rejects future writes', () => {
  const map = new ObservableMap();
  let called = 0;
  map.subscribe(() => called++);
  map.set('x', 1);
  map.dispose();
  map.dispose();
  assert.equal(called, 1);
  assert.equal(map.get('x'), 1);
  assert.throws(() => map.delete('x'), ObservableMapDisposedError);
  assert.throws(() => map.subscribe(() => {}), ObservableMapDisposedError);
});

test('subscription self-removal and subscriptions during dispatch use snapshots', () => {
  const map = new ObservableMap();
  const seen = [];
  let stop = () => {};
  stop = map.subscribe(() => {
    seen.push('first');
    stop();
    map.subscribe(() => seen.push('late'));
  });
  map.subscribe(() => seen.push('second'));
  map.set('a', 1);
  assert.deepEqual(seen, ['first', 'second']);
  map.set('b', 2);
  assert.deepEqual(seen, ['first', 'second', 'second', 'late']);
});
