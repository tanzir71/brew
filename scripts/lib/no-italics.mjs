import postcss from 'postcss';
import ts from 'typescript';

const normalStyles = new Set(['normal', 'inherit', 'initial', 'unset']);
const semanticTags = new Set(['em', 'i', 'cite', 'dfn', 'address', 'var']);
const decodeCss = (value) =>
  value.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex, character) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : character,
  );
const clean = (value) =>
  decodeCss(value.replace(/\/\*[\s\S]*?\*\//g, ' '))
    .trim()
    .toLowerCase();
const slantedFont = (value) =>
  /\b(?:italic|oblique)\b/.test(clean(value).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ''));

export function checkCss(source, filename = 'styles.css') {
  const problems = [];
  let normalReset = false;
  try {
    const root = postcss.parse(source, { from: filename });
    root.walkDecls((declaration) => {
      const property = clean(declaration.prop);
      const value = clean(declaration.value);
      if (
        (property === 'font-style' && !normalStyles.has(value)) ||
        (property === 'font' && slantedFont(value))
      )
        problems.push({
          line: declaration.source.start.line,
          message: 'Use normal font styles; italic and oblique text are not allowed.',
        });
    });
    root.walkRules((rule) => {
      if (!rule.selector.split(',').some((selector) => clean(selector) === '*')) return;
      for (let parent = rule.parent; parent.type !== 'root'; parent = parent.parent)
        if (parent.type !== 'atrule' || parent.name !== 'layer') return;
      if (
        rule.nodes.some(
          (node) =>
            node.type === 'decl' &&
            clean(node.prop) === 'font-style' &&
            clean(node.value) === 'normal' &&
            node.important,
        )
      )
        normalReset = true;
    });
  } catch (error) {
    problems.push({
      line: error.line ?? 1,
      message: `Cannot check stylesheet: ${error.reason ?? error.message}`,
    });
  }
  return { problems, normalReset };
}
export function italicUtility(value) {
  return value.split(/\s+/).some((token) => {
    const utility = token.replace(/!$/, '').split(':').at(-1).replace(/^!/, '');
    if (utility === 'italic') return true;
    const arbitrary = token.match(/\[(font-style|font):([^\]]+)\]/);
    return arbitrary
      ? arbitrary[1] === 'font-style'
        ? !normalStyles.has(clean(arbitrary[2].replaceAll('_', ' ')))
        : slantedFont(arbitrary[2].replaceAll('_', ' '))
      : false;
  });
}
export function checkMarkup(source, normalReset, filename = 'document.html') {
  const problems = [];
  const html = source.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^<>]*?)>/gi)) {
    const line = html.slice(0, match.index).split('\n').length;
    if (semanticTags.has(match[1].toLowerCase()) && !normalReset)
      problems.push({ line, message: 'Semantic emphasis needs the global normal-font reset.' });
    for (const attribute of match[2].matchAll(
      /\b(class|style|font-style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    )) {
      const name = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4];
      if (
        (name === 'class' && italicUtility(value)) ||
        (name === 'font-style' && !normalStyles.has(clean(value)))
      )
        problems.push({
          line,
          message: 'Use normal typography instead of an italic utility or SVG attribute.',
        });
      if (name === 'style')
        problems.push(
          ...checkCss(`x { ${value} }`, filename).problems.map((problem) => ({ ...problem, line })),
        );
    }
  }
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    problems.push(...checkCss(style[1], filename).problems);
  return problems;
}
export function checkScript(source, normalReset, filename = 'component.tsx') {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const problems = [];
  const bindings = new Map();
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      bindings.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const report = (node, message) =>
    problems.push({
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      message,
    });
  const nameOf = (node) =>
    node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : '';
  const strings = (node, visit, seen = new Set()) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (ts.isStringLiteralLike(node)) visit(node.text, node);
    else if (ts.isIdentifier(node)) strings(bindings.get(node.text), visit, seen);
    else if (ts.isConditionalExpression(node)) {
      strings(node.whenTrue, visit, seen);
      strings(node.whenFalse, visit, seen);
    } else if (ts.isTemplateExpression(node)) {
      visit(node.head.text, node);
      node.templateSpans.forEach((span) => {
        strings(span.expression, visit, seen);
        visit(span.literal.text, span.literal);
      });
    } else if (ts.isObjectLiteralExpression(node))
      node.properties.forEach((property) => {
        if (property.name) visit(nameOf(property.name), property);
      });
    else ts.forEachChild(node, (child) => strings(child, visit, seen));
  };
  const classes = (node) =>
    strings(node, (value, at) => {
      if (italicUtility(value)) report(at, 'Use normal typography instead of an italic utility.');
    });
  const styleValue = (node, property) => {
    let known = false;
    strings(node, (value, at) => {
      known = true;
      if (property === 'font' ? slantedFont(value) : !normalStyles.has(clean(value)))
        report(at, 'Use normal font styles.');
    });
    if (!known && property === 'font-style') report(node, 'Use an explicit normal font style.');
  };
  const styles = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (ts.isIdentifier(node)) styles(bindings.get(node.text), seen);
    else if (ts.isObjectLiteralExpression(node))
      node.properties.forEach((property) => {
        if (ts.isPropertyAssignment(property)) {
          const name = nameOf(property.name);
          if (['fontStyle', 'font-style', 'font'].includes(name))
            styleValue(property.initializer, name === 'font' ? 'font' : 'font-style');
        } else if (ts.isSpreadAssignment(property)) styles(property.expression, seen);
      });
    else ts.forEachChild(node, (child) => styles(child, seen));
  };
  const walk = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (semanticTags.has(node.tagName.getText(file)) && !normalReset)
        report(node, 'Semantic emphasis needs the global normal-font reset.');
      for (const attribute of node.attributes.properties)
        if (ts.isJsxAttribute(attribute) && attribute.initializer) {
          const expression = ts.isJsxExpression(attribute.initializer)
            ? attribute.initializer.expression
            : attribute.initializer;
          if (['class', 'className'].includes(attribute.name.getText(file))) classes(expression);
          if (attribute.name.getText(file) === 'style') styles(expression);
          if (['fontStyle', 'font-style'].includes(attribute.name.getText(file)))
            styleValue(expression, 'font-style');
        }
    }
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (node.text.includes('<'))
        for (const problem of checkMarkup(node.text, normalReset, filename))
          report(node, problem.message);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const property = ts.isPropertyAccessExpression(node.left)
        ? node.left.name.text
        : ts.isElementAccessExpression(node.left)
          ? nameOf(node.left.argumentExpression)
          : '';
      if (property === 'className') classes(node.right);
      if (['fontStyle', 'font-style'].includes(property)) styleValue(node.right, 'font-style');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const property = nameOf(node.arguments[0]);
      if (method === 'setAttribute' && ['class', 'className'].includes(property))
        classes(node.arguments[1]);
      if (method === 'setAttribute' && property === 'style')
        strings(node.arguments[1], (value, at) => {
          for (const problem of checkCss(`x {${value}}`, filename).problems)
            report(at, problem.message);
        });
      if (method === 'setProperty' && ['font-style', 'font'].includes(property))
        styleValue(node.arguments[1], property);
      if (
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'classList' &&
        ['add', 'toggle', 'replace'].includes(method)
      )
        node.arguments.forEach(classes);
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return problems;
}
