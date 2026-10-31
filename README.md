# @lp-labs/observable-map

A `Map`-like typed store that notifies subscribers of effective changes. It
supports key-filtered listeners, nested batches, abortable subscriptions, and
deterministic notification when listeners mutate the map reentrantly.

## Import

```ts
import { ObservableMap } from "@lp-labs/observable-map";

const state = new ObservableMap<string, number>();
```

The package provides ESM and CommonJS entry points with matching TypeScript
declarations. It has no runtime dependencies and requires Node.js 18 or newer.

## API

Runtime exports:

- `ObservableMap<K, V>` stores entries and exposes the familiar `size`, `get`,
  `has`, `set`, `delete`, `clear`, `entries`, `keys`, `values`, `forEach`, and
  iteration operations. The constructor optionally accepts iterable entries.
  `set` returns the map; `delete` returns whether a key existed. Setting an
  existing key to an `Object.is`-equal value and deleting/clearing absent data
  are no-ops.
- `ObservableMapDisposedError` is thrown by mutators, `subscribe`, and `batch`
  after `dispose()`.

Additional `ObservableMap<K, V>` members:

- `subscribe(listener, { key?, signal? })` returns an idempotent unsubscribe
  function. Without `key`, the listener receives all changes. With `key`, it
  receives only matching changes; batch and clear events are filtered to that
  key. An already-aborted signal creates no subscription.
- `batch(operation)` executes synchronously and delivers the collected changes
  once as a `batch` event after the outermost batch completes. Nested batches
  contribute to the same event. Changes remain applied if the callback throws;
  queued changes are still notified before that exception is rethrown.
- `isDisposed` indicates lifecycle state. `dispose()` is idempotent, removes
  listeners, clears pending notifications, and leaves read operations usable.

Events are discriminated by `type`:

- `set`: `{ type, key, value, previous, hadPrevious }`.
- `delete`: `{ type, key, previous }`.
- `clear`: `{ type, entries }` with the removed key/value pairs.
- `batch`: `{ type, changes }` containing the ordered individual changes.

Event objects and change/entry snapshot arrays are frozen before notification;
objects stored as keys or values are not deep-frozen.

The runtime exports are `ObservableMap` and `ObservableMapDisposedError`.
`SetChange`, `DeleteChange`, `ClearChange`, `MapChange`, `BatchChange`,
`ObservableMapEvent`, `MapListener`, `Unsubscribe`, and `SubscribeOptions` are
TypeScript-only exports.

## Example

```ts
const state = new ObservableMap<string, number>();
const stop = state.subscribe((event) => console.log(event), { key: "count" });

state.batch((map) => {
  map.set("count", 1);
  map.set("other", 2);
  map.set("count", 3);
});
// The keyed listener receives one batch containing only the two "count" changes.

stop();
state.dispose();
```

Listeners run in subscription order from a snapshot. Mutations during dispatch
are queued and notified after the current event has reached its listeners.
Listener exceptions do not prevent other listeners or queued events from
running; after the dispatch drains, the mutating call throws an `AggregateError`
containing the listener errors. A reentrant mutation can therefore take effect
even when the outer mutator subsequently throws that aggregate. If both a
batch callback and a listener fail, `batch` throws an `AggregateError`
containing the callback error and the listener aggregate.

## Typing and limits

Keys and values are generic and map operations use JavaScript `Map` semantics.
Subscriptions are synchronous and local to this instance. This class is not a
proxy, persistence layer, cross-process store, or concurrency primitive;
reentrant callbacks execute synchronously in deterministic queue order.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
