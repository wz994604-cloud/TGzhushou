let j;

const knownAsyncIdentifiers = new Set([
  'openDatabase','getSetting','setSetting',
  'listPublishers','getPublisher','savePublisher',
  'initializePlayerImports','legacyPlayerBotId','playerSourceToken','savePlayerSourceToken','upsertPlayers',
  'createBrowserAuth','sentActions'
]);
const knownAsyncMembers = new Map([
  ['browserAuth', new Set(['authenticate','issueLink'])],
  ['scheduler', new Set(['publisher','tick','queueNow','queueDue','queueBroadcast'])],
  ['sent', new Set(['read','act'])]
]);

function memberName(node) {
  if (!node || node.type !== 'MemberExpression' || node.computed) return null;
  return node.property.type === 'Identifier' ? node.property.name : null;
}
function isDbMember(node, name) {
  return node?.type === 'MemberExpression' && !node.computed &&
    node.object?.type === 'Identifier' && node.object.name === 'db' &&
    node.property?.type === 'Identifier' && node.property.name === name;
}
function isDbPrepareCall(node) {
  return node?.type === 'CallExpression' && isDbMember(node.callee, 'prepare');
}
function isPromiseHandled(path) {
  const parent = path.parent?.node;
  if (parent?.type === 'AwaitExpression') return true;
  if (parent?.type === 'UnaryExpression' && parent.operator === 'void') return true;
  if (parent?.type === 'MemberExpression' && parent.object === path.node && !parent.computed &&
      ['catch','then','finally'].includes(parent.property?.name)) return true;
  return false;
}
function nearestFunction(path) {
  let cursor = path;
  while (cursor) {
    const node = cursor.node;
    if (node && ['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod'].includes(node.type)) return cursor;
    cursor = cursor.parent;
  }
  return null;
}
function markAsync(path) {
  const fn = nearestFunction(path);
  if (fn) fn.node.async = true;
}
function awaitCall(path, { allowHandled = false } = {}) {
  if (!allowHandled && isPromiseHandled(path)) return false;
  if (path.parent?.node?.type === 'AwaitExpression') return false;
  const original = path.node;
  j(path).replaceWith(j.awaitExpression(original));
  markAsync(path);
  return true;
}

module.exports = function transform(fileInfo, api) {
  j = api.jscodeshift.withParser('babel');
  const root = j(fileInfo.source);
  const prepared = new Set();
  const transactions = new Set();

  root.find(j.VariableDeclarator).forEach(path => {
    if (path.node.id.type !== 'Identifier') return;
    const init = path.node.init;
    if (isDbPrepareCall(init)) prepared.add(path.node.id.name);
    if (init?.type === 'CallExpression' && isDbMember(init.callee, 'transaction')) transactions.add(path.node.id.name);
  });

  root.find(j.CallExpression).forEach(path => {
    const node = path.node;
    if (isDbMember(node.callee, 'transaction')) {
      const callback = node.arguments[0];
      if (callback && ['FunctionExpression','ArrowFunctionExpression'].includes(callback.type)) callback.async = true;
    }
  });

  root.find(j.CallExpression).forEach(path => {
    const node = path.node;
    const callee = node.callee;
    let shouldAwait = false;
    let allowHandled = false;

    if (callee?.type === 'MemberExpression' && !callee.computed) {
      const prop = memberName(callee);
      if (['get','all','run'].includes(prop) && isDbPrepareCall(callee.object)) {
        shouldAwait = true; allowHandled = true;
      } else if (['get','all','run'].includes(prop) && callee.object?.type === 'Identifier' && prepared.has(callee.object.name)) {
        shouldAwait = true; allowHandled = true;
      } else if (callee.object?.type === 'Identifier' && callee.object.name === 'db' && ['exec','close'].includes(prop)) {
        shouldAwait = true; allowHandled = true;
      } else if (callee.object?.type === 'Identifier') {
        const methods = knownAsyncMembers.get(callee.object.name);
        if (methods?.has(prop)) shouldAwait = true;
      }
    }

    if (callee?.type === 'CallExpression' && isDbMember(callee.callee, 'transaction')) {
      shouldAwait = true; allowHandled = true;
    }
    if (callee?.type === 'Identifier' && transactions.has(callee.name)) {
      shouldAwait = true; allowHandled = true;
    }
    if (callee?.type === 'Identifier' && knownAsyncIdentifiers.has(callee.name)) shouldAwait = true;

    if (shouldAwait) awaitCall(path, { allowHandled });
  });

  let changed = true;
  while (changed) {
    changed = false;
    const asyncLocals = new Set();
    root.find(j.FunctionDeclaration).forEach(path => {
      if (path.node.async && path.node.id?.name) asyncLocals.add(path.node.id.name);
    });
    root.find(j.VariableDeclarator).forEach(path => {
      if (path.node.id.type === 'Identifier' && path.node.init &&
          ['ArrowFunctionExpression','FunctionExpression'].includes(path.node.init.type) && path.node.init.async) {
        asyncLocals.add(path.node.id.name);
      }
    });
    root.find(j.CallExpression).forEach(path => {
      if (path.node.callee?.type === 'Identifier' && asyncLocals.has(path.node.callee.name)) {
        if (awaitCall(path)) changed = true;
      }
    });
  }

  return root.toSource({ quote: 'single', lineTerminator: '\n', trailingComma: false });
};
