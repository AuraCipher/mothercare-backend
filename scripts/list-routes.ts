import app from '../src/app';

function extractRoutes(stack: any[], prefix: string = '', results: string[] = []) {
  if (!stack) return results;

  for (const layer of stack) {
    if (layer.route) {
      // Direct route handler
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      results.push(`${methods} ${prefix}${layer.route.path}`);
    } else if (layer.name === 'router' && layer.handle?.stack) {
      // Nested router — try to extract its mount path
      const layerPath = getExpressLayerPath(layer);
      extractRoutes(layer.handle.stack, prefix + layerPath, results);
    }
  }
  return results;
}

function getExpressLayerPath(layer: any): string {
  // Express stores the path pattern in layer.keys and layer.regexp
  // but it's harder to extract. Try common patterns:
  if (layer.regexp) {
    const regexStr = layer.regexp.toString();
    // Extract path from regex like /^\/branches\/(?:([^\/]+?))\/members\/?(?=\/|$)/i
    const matches = regexStr.match(/^\/(\^?\\?\/?)([a-z-]+)/i);
    if (matches) {
      return '/' + matches[2].replace(/\\\//g, '');
    }
    // Try another pattern
    const simpleMatch = regexStr.match(/\/([a-z_-]+)/i);
    if (simpleMatch) return simpleMatch[0];
  }
  return '';
}

const routes = extractRoutes(app._router.stack);
routes.sort();

console.log('\n=== All Registered Routes ===\n');
routes.forEach(r => console.log(r));
console.log(`\nTotal: ${routes.length} routes`);
