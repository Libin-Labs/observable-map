import mapPackage = require('@lp-labs/observable-map');

const map = new mapPackage.ObservableMap<string, number>();
map.set('count', 4);
const count: number | undefined = map.get('count');
void count;
// @ts-expect-error map values are numbers
map.set('count', 'four');
