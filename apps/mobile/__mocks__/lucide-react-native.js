// Auto-applied jest mock for lucide-react-native: its dist is .mjs, which jest-expo's transform
// doesn't cover. Icons are visual chrome — tests only need them to render as inert elements, so
// a Proxy hands back a named stub component for every icon import.
const React = require('react');

module.exports = new Proxy(
  {},
  {
    get(_target, name) {
      if (name === '__esModule') return true;
      const Icon = (props) => React.createElement('LucideIcon', { icon: String(name), ...props });
      Icon.displayName = String(name);
      return Icon;
    },
  },
);
