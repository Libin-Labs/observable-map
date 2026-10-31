import { ObservableMap, type MapChange } from '@lp-labs/observable-map';

const map = new ObservableMap<string, number>();
map.set('total', 3);
const event: MapChange<string, number> | undefined = undefined;
map.subscribe((change) => {
  const typed: string | undefined = change.type === 'set' ? change.key : undefined;
  void typed;
});
void event;
// @ts-expect-error map values are numbers
map.set('count', 'three');
