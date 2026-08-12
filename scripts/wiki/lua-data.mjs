import luaparse from 'luaparse';

function finiteNumber(node, context, path) {
  const value = literal(node, context, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Unsupported non-finite Lua arithmetic');
  return value;
}

function literal(node, context, path) {
  switch (node?.type) {
    case 'StringLiteral':
      return Buffer.from(node.value, 'latin1').toString('utf8');
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'TableConstructorExpression':
      return table(node, context, path);
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument?.type === 'NumericLiteral') return -node.argument.value;
      throw new Error(`Unsupported Lua unary expression: ${node.operator}`);
    case 'BinaryExpression': {
      if (node.operator !== '+' && node.operator !== '/') throw new Error(`Unsupported Lua binary expression: ${node.operator}`);
      const left = finiteNumber(node.left, context, path);
      const right = finiteNumber(node.right, context, path);
      if (node.operator === '/' && right === 0) throw new Error('Unsupported Lua division by zero');
      const result = node.operator === '+' ? left + right : left / right;
      if (!Number.isFinite(result)) throw new Error('Unsupported non-finite Lua arithmetic');
      return result;
    }
    default:
      throw new Error(`Unsupported Lua AST node: ${node?.type ?? 'missing'}`);
  }
}

function keyValue(node) {
  if (node.type === 'StringLiteral') return { type: 'string', value: Buffer.from(node.value, 'latin1').toString('utf8') };
  if (node.type === 'NumericLiteral') return { type: 'number', value: node.value };
  if (node.type === 'Identifier') return { type: 'string', value: node.name };
  throw new Error(`Unsupported Lua table key: ${node.type}`);
}

function pathName(path) {
  return path.map((key, index) => typeof key === 'number' ? `[${key}]` : `${index ? '.' : ''}${key}`).join('');
}

function location(node) {
  return node.loc ? `${node.loc.start.line}:${node.loc.start.column + 1}` : 'unknown';
}

function table(node, context, path) {
  const array = node.fields.every(field => field.type === 'TableValue');
  if (array) return node.fields.map((field, index) => literal(field.value, context, [...path, index + 1]));

  const value = {};
  const keys = new Map();
  let nextIndex = 1;
  for (const field of node.fields) {
    const luaKey = field.type === 'TableValue'
      ? { type: 'number', value: nextIndex++ }
      : keyValue(field.key);
    const key = String(luaKey.value);
    const previous = keys.get(key);
    if (previous && (previous.type !== luaKey.type || !Object.is(previous.value, luaKey.value))) {
      throw new Error(`Normalized Lua key collision at ${pathName(path)}: ${previous.type} ${key} and ${luaKey.type} ${key}`);
    }
    if (previous) context.warn(`Lua table key overwritten at ${pathName([...path, luaKey.value])} (${previous.location} -> ${location(field)})`);
    keys.set(key, { ...luaKey, location: location(field) });
    value[key] = literal(field.value, context, [...path, luaKey.value]);
  }
  return value;
}

export function parseLuaData(source, { warn = console.warn } = {}) {
  const byteSource = Buffer.from(source, 'utf8').toString('latin1');
  const ast = luaparse.parse(byteSource, { comments: false, luaVersion: '5.3', encodingMode: 'pseudo-latin1', locations: true });
  if (ast.body.length !== 1 || ast.body[0].type !== 'ReturnStatement' || ast.body[0].arguments.length !== 1) {
    throw new Error('Unsupported Lua module: expected one return statement');
  }
  if (ast.body[0].arguments[0].type !== 'TableConstructorExpression') {
    throw new Error('Unsupported Lua module: return value must be a table');
  }
  return literal(ast.body[0].arguments[0], { warn }, []);
}

export function assertPcSource(source) {
  if (/WR Data|ChampionDataWR/i.test(source)) {
    throw new Error(`Wild Rift source is not allowed: ${source}`);
  }
}

export function championSkillForms(champion, slot) {
  const value = champion[`skill_${slot.toLowerCase()}`];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every(form => typeof form === 'string')) return value;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length && entries.every(([key, form], index) => key === String(index + 1) && typeof form === 'string')) {
      return entries.map(([, form]) => form);
    }
  }
  if (value == null) return [];
  throw new Error(`Invalid skill_${slot.toLowerCase()} value`);
}
