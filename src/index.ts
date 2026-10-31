export interface SetChange<K, V> {
  readonly type: 'set';
  readonly key: K;
  readonly value: V;
  readonly previous: V | undefined;
  readonly hadPrevious: boolean;
}

export interface DeleteChange<K, V> {
  readonly type: 'delete';
  readonly key: K;
  readonly previous: V;
}

export interface ClearChange<K, V> {
  readonly type: 'clear';
  readonly entries: readonly (readonly [K, V])[];
}

export type MapChange<K, V> = SetChange<K, V> | DeleteChange<K, V> | ClearChange<K, V>;

export interface BatchChange<K, V> {
  readonly type: 'batch';
  readonly changes: readonly MapChange<K, V>[];
}

export type ObservableMapEvent<K, V> = MapChange<K, V> | BatchChange<K, V>;
export type MapListener<K, V> = (event: ObservableMapEvent<K, V>) => void;
export type Unsubscribe = () => void;

interface ListenerEntry<K, V> {
  readonly callback: MapListener<K, V>;
  readonly key: K | undefined;
  readonly hasKey: boolean;
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
  active: boolean;
}

export interface SubscribeOptions<K> {
  readonly key?: K;
  readonly signal?: AbortSignal;
}

export class ObservableMapDisposedError extends Error {
  constructor() {
    super('The observable map has been disposed.');
    this.name = 'ObservableMapDisposedError';
  }
}

export class ObservableMap<K, V> implements Iterable<[K, V]> {
  private readonly data = new Map<K, V>();
  private readonly listeners = new Set<ListenerEntry<K, V>>();
  private readonly events: ObservableMapEvent<K, V>[] = [];
  private readonly batchChanges: MapChange<K, V>[] = [];
  private batchDepth = 0;
  private dispatching = false;
  private disposed = false;

  constructor(entries?: Iterable<readonly [K, V]>) {
    if (entries) for (const [key, value] of entries) this.data.set(key, value);
  }

  get size(): number {
    return this.data.size;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get(key: K): V | undefined {
    return this.data.get(key);
  }

  has(key: K): boolean {
    return this.data.has(key);
  }

  set(key: K, value: V): this {
    this.assertActive();
    const hadPrevious = this.data.has(key);
    const previous = this.data.get(key);
    if (hadPrevious && Object.is(previous, value)) return this;
    this.data.set(key, value);
    this.enqueue({
      type: 'set',
      key,
      value,
      previous,
      hadPrevious,
    });
    return this;
  }

  delete(key: K): boolean {
    this.assertActive();
    if (!this.data.has(key)) return false;
    const previous = this.data.get(key) as V;
    this.data.delete(key);
    this.enqueue({ type: 'delete', key, previous });
    return true;
  }

  clear(): void {
    this.assertActive();
    if (this.data.size === 0) return;
    const entries = [...this.data.entries()];
    this.data.clear();
    this.enqueue({ type: 'clear', entries });
  }

  subscribe(callback: MapListener<K, V>, options: SubscribeOptions<K> = {}): Unsubscribe {
    this.assertActive();
    if (typeof callback !== 'function') throw new TypeError('Listener must be a function.');
    const { signal } = options;
    if (signal?.aborted) return () => {};
    const entry = {
      callback,
      key: options.key,
      hasKey: Object.prototype.hasOwnProperty.call(options, 'key'),
      signal,
      active: true,
      abort: () => this.remove(entry),
    };
    this.listeners.add(entry);
    signal?.addEventListener('abort', entry.abort, { once: true });
    return entry.abort;
  }

  batch<R>(operation: (map: this) => R): R {
    this.assertActive();
    if (typeof operation !== 'function') throw new TypeError('Batch operation must be a function.');
    let result: R | undefined;
    let operationFailed = false;
    let operationError: unknown;
    this.batchDepth++;
    try {
      result = operation(this);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }
    this.batchDepth--;
    if (this.batchDepth === 0 && this.batchChanges.length > 0) {
      const changes = this.batchChanges.splice(0);
      try {
        this.enqueue({ type: 'batch', changes });
      } catch (error) {
        if (operationFailed) {
          throw new AggregateError(
            [operationError, error],
            'The batch callback and one or more listeners failed.',
          );
        }
        throw error;
      }
    }
    if (operationFailed) throw operationError;
    return result as R;
  }

  entries(): MapIterator<[K, V]> {
    return this.data.entries();
  }

  keys(): MapIterator<K> {
    return this.data.keys();
  }

  values(): MapIterator<V> {
    return this.data.values();
  }

  forEach(callback: (value: V, key: K, map: this) => void, thisArg?: unknown): void {
    this.data.forEach((value, key) => callback.call(thisArg, value, key, this));
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const listener of [...this.listeners]) this.remove(listener);
    this.events.length = 0;
  }

  private assertActive(): void {
    if (this.disposed) throw new ObservableMapDisposedError();
  }

  private remove(entry: ListenerEntry<K, V>): void {
    if (!entry.active) return;
    entry.active = false;
    this.listeners.delete(entry);
    entry.signal?.removeEventListener('abort', entry.abort);
  }

  private enqueue(event: ObservableMapEvent<K, V>): void {
    if (this.batchDepth > 0) {
      if (event.type === 'batch') this.batchChanges.push(...event.changes);
      else this.batchChanges.push(event);
      return;
    }
    this.events.push(immutableEvent(event));
    if (this.dispatching) return;
    this.dispatching = true;
    const errors: unknown[] = [];
    try {
      while (this.events.length > 0) {
        const current = this.events.shift() as ObservableMapEvent<K, V>;
        for (const entry of [...this.listeners]) {
          if (!entry.active) continue;
          const selected = entry.hasKey ? this.select(entry.key as K, current) : current;
          if (selected === undefined) continue;
          try {
            entry.callback(entry.hasKey ? immutableEvent(selected) : current);
          } catch (error) {
            errors.push(error);
          }
        }
      }
    } finally {
      this.dispatching = false;
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more observable map listeners failed.');
    }
  }

  private matches(key: K, event: ObservableMapEvent<K, V>): boolean {
    if (event.type === 'batch') return event.changes.some((change) => this.matches(key, change));
    if (event.type === 'clear') return event.entries.some(([entryKey]) => sameKey(entryKey, key));
    return sameKey(event.key, key);
  }

  private select(key: K, event: ObservableMapEvent<K, V>): ObservableMapEvent<K, V> | undefined {
    if (!this.matches(key, event)) return undefined;
    if (event.type === 'batch') {
      return {
        type: 'batch',
        changes: event.changes
          .map((change) => this.select(key, change))
          .filter((change): change is MapChange<K, V> => change !== undefined),
      };
    }
    if (event.type === 'clear') {
      return {
        type: 'clear',
        entries: event.entries.filter(([entryKey]) => sameKey(entryKey, key)),
      };
    }
    return event;
  }
}

function sameKey<K>(left: K, right: K): boolean {
  return left === right || (left !== left && right !== right);
}

function immutableEvent<K, V>(event: ObservableMapEvent<K, V>): ObservableMapEvent<K, V> {
  if (event.type !== 'batch') return immutableChange(event);
  return Object.freeze({
    type: 'batch',
    changes: Object.freeze(event.changes.map(immutableChange)),
  });
}

function immutableChange<K, V>(change: MapChange<K, V>): MapChange<K, V> {
  if (change.type !== 'clear') return Object.freeze({ ...change });
  const entries = Object.freeze(
    change.entries.map(([key, value]) => Object.freeze([key, value] as const)),
  );
  return Object.freeze({ type: 'clear', entries });
}
