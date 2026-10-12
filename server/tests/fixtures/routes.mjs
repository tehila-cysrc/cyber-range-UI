// Walks an Express 4 app and lists every route as { method, path, permissions } — permissions are the
// `.permission` tags of requirePermission guards found in the route's own handler chain.
function mountPath(layer) {
  // Express 4 compiles app.use('/api/admin', router) to /^\/api\/admin\/?(?=\/|$)/i.
  const src = layer.regexp?.source ?? '';
  if (src === '^\\/?(?=\\/|$)') return '';
  return src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/');
}

export function listRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const permissions = layer.route.stack.map((h) => h.handle?.permission).filter(Boolean);
        for (const method of Object.keys(layer.route.methods)) {
          out.push({ method: method.toUpperCase(), path: prefix + layer.route.path, permissions });
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };
  walk(app._router.stack, '');
  return out;
}
