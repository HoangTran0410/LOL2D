import luaparse from 'luaparse';

function literal(node) {
  switch (node?.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'TableConstructorExpression':
      return table(node);
    default:
      throw new Error(`Unsupported Lua AST node: ${node?.type ?? 'missing'}`);
  }
}

function keyValue(node) {
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return node.value;
  if (node.type === 'Identifier') return node.name;
  throw new Error(`Unsupported Lua table key: ${node.type}`);
}

function table(node) {
  const array = node.fields.every(field => field.type === 'TableValue');
  if (array) return node.fields.map(field => literal(field.value));

  const value = {};
  let nextIndex = 1;
  for (const field of node.fields) {
    const key = field.type === 'TableValue'
      ? String(nextIndex++)
      : String(keyValue(field.key));
    if (Object.hasOwn(value, key)) throw new Error(`Duplicate normalized Lua key: ${key}`);
    value[key] = literal(field.value);
  }
  return value;
}

export function parseLuaData(source) {
  const ast = luaparse.parse(source, { comments: false, luaVersion: '5.3', encodingMode: 'x-user-defined' });
  if (ast.body.length !== 1 || ast.body[0].type !== 'ReturnStatement' || ast.body[0].arguments.length !== 1) {
    throw new Error('Unsupported Lua module: expected one return statement');
  }
  if (ast.body[0].arguments[0].type !== 'TableConstructorExpression') {
    throw new Error('Unsupported Lua module: return value must be a table');
  }
  return literal(ast.body[0].arguments[0]);
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
  if (value == null) return [];
  throw new Error(`Invalid skill_${slot.toLowerCase()} value`);
}
