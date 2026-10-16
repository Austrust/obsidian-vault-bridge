'use strict';
// Bounded LCS on changed lines; large edits fall back to a replacement block.
function lineDiff(before, after) {
  const split = (s) => (s ? s.match(/[^\n]*\n|[^\n]+$/g) || [] : []);
  const a = split(before),
    b = split(after);
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const rows = [];
  let old = 1,
    next = 1;
  const add = (kind, text) =>
    rows.push({
      kind,
      text,
      old: kind === 'add' ? null : old++,
      next: kind === 'remove' ? null : next++,
    });
  for (let i = 0; i < start; i++) add('same', a[i]);
  const x = a.slice(start, a.length - end),
    y = b.slice(start, b.length - end);
  if (!x.length || !y.length || x.length * y.length > 1000000) {
    for (const t of x) add('remove', t);
    for (const t of y) add('add', t);
  } else {
    const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        table[i][j] =
          x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        add('same', x[i]);
        i++;
        j++;
      } else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1]))
        add('remove', x[i++]);
      else add('add', y[j++]);
    }
  }
  for (let i = a.length - end; i < a.length; i++) add('same', a[i]);
  return rows;
}
function diffContext(rows, context = 3) {
  const keep = new Set();
  for (let i = 0; i < rows.length; i++)
    if (rows[i].kind !== 'same')
      for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++)
        keep.add(j);
  const out = [];
  let skipping = false;
  for (let i = 0; i < rows.length; i++) {
    if (keep.has(i)) {
      out.push(rows[i]);
      skipping = false;
    } else if (!skipping) {
      out.push({ kind: 'skip' });
      skipping = true;
    }
  }
  return out;
}
module.exports = { lineDiff, diffContext };
