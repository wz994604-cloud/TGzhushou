let j;

const knownAsyncIdentifiers = new Set([
  'openDatabase','getSetting','setSetting','saveIncoming',
  'listPublishers','getPublisher','savePublisher',
  'initializePlayerImports','legacyPlayerBotId','playerSourceToken','savePlayerSourceToken','upsertPlayers',
  'createBrowserAuth','sentActions'
]);
const knownAsyncMembers = new Map([
  ['browserAuth', new Set(['authenticate','issueLink'])],
  ['auth', new Set(['authenticate','issueLink'])],
  ['scheduler', new Set(['publisher','tick','queueNow','queueDue','queueBroadcast'])],
  ['sent', new Set(['read','act'])],
  ['actions', new Set(['read','act'])]
]);
const factoryMethods = new Map([
  ['createBrowserAuth', new Set(['authenticate','issueLink'])],
  ['createScheduler', new Set(['publisher','tick','queueNow','queueDue','queueBroadcast'])],
  ['sentActions', new Set(['read','act'])]
]);

function memberName(node) {
  if (!node || node.type !== 'MemberExpression' || node.computed) return null;
  return node.property.type === 'Identifier' ? node.property.name : null;
}
function objectLabel(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  return memberName(node);
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
  const factoryObjects = new Map();

  root.find(j.VariableDeclarator).forEach(path => {
    if (path.node.id.type !== 'Identifier') return;
    const init = path.node.init;
    if (isDbPrepareCall(init)) prepared.add(path.node.id.name);
    if (init?.type === 'CallExpression' && isDbMember(init.callee, 'transaction')) transactions.add(path.node.id.name);
    if (init?.type === 'CallExpression' && init.callee?.type === 'Identifier' && factoryMethods.has(init.callee.name)) {
      factoryObjects.set(path.node.id.name, factoryMethods.get(init.callee.name));
    }
  });
  root.find(j.AssignmentExpression).forEach(path => {
    const {left,right} = path.node;
    if (left?.type === 'Identifier' && right?.type === 'CallExpression' && right.callee?.type === 'Identifier' && factoryMethods.has(right.callee.name)) {
      factoryObjects.set(left.name, factoryMethods.get(right.callee.name));
    }
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
      const label = objectLabel(callee.object);
      if (['get','all','run'].includes(prop) && isDbPrepareCall(callee.object)) {
        shouldAwait = true; allowHandled = true;
      } else if (['get','all','run'].includes(prop) && callee.object?.type === 'Identifier' && prepared.has(callee.object.name)) {
        shouldAwait = true; allowHandled = true;
      } else if (callee.object?.type === 'Identifier' && callee.object.name === 'db' && ['exec','close'].includes(prop)) {
        shouldAwait = true; allowHandled = true;
      } else if (label && knownAsyncMembers.get(label)?.has(prop)) {
        shouldAwait = true;
      } else if (callee.object?.type === 'Identifier' && factoryObjects.get(callee.object.name)?.has(prop)) {
        shouldAwait = true;
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

  root.find(j.CallExpression).forEach(path => {
    const callee = path.node.callee;
    if (callee?.type !== 'MemberExpression' || callee.computed || callee.object?.type !== 'Identifier' ||
        callee.object.name !== 'assert' || callee.property?.name !== 'throws') return;
    const callback = path.node.arguments[0];
    if (!callback || !['FunctionExpression','ArrowFunctionExpression'].includes(callback.type) || !callback.async) return;
    callee.property.name = 'rejects';
    awaitCall(path, { allowHandled:true });
  });

  return root.toSource({ quote: 'single', lineTerminator: '\n', trailingComma: false });
};
