// Jest stand-in for lucide-react-native (ESM-only package): every icon renders nothing.
const Icon = () => null;
module.exports = new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : Icon) });
